package com.resilientgeo.mesh.emergency

import com.resilientgeo.mesh.data.ChunkIngestResult
import com.resilientgeo.mesh.protocol.ChunkRef
import com.resilientgeo.mesh.protocol.DatasetSummary
import com.resilientgeo.mesh.protocol.DiffResult
import com.resilientgeo.mesh.protocol.PeerSummary
import com.resilientgeo.mesh.protocol.PeerSync
import com.resilientgeo.mesh.protocol.PeerSyncException
import com.resilientgeo.mesh.protocol.RequestMessage
import com.resilientgeo.mesh.transport.Connection
import com.resilientgeo.mesh.transport.PeerTransport
import com.resilientgeo.mesh.transport.TransferResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Runs HELLO -> DIFF -> REQUEST -> TRANSFER automatically with every peer
 * [PeerTransport.discover] finds, with no human choosing roles.
 *
 * `PeerSyncMilestoneActivity` needs a person to tap "Node A" / "Node B"
 * because *it* imposes a fixed requester/server split for demo clarity —
 * that split is not a property of the protocol itself. `PeerSync.computeDiff`
 * and `PeerSync.buildRequest` are pure functions of two summaries: whoever
 * receives a HELLO can compute its own diff against it, and whoever receives
 * a REQUEST can serve whatever it actually holds. Two strangers meeting need
 * no negotiation over who does which — both connect to each other (matching
 * `BleGattTransport`'s "every device is both central and peripheral"
 * design), both send their own HELLO, and both independently run the
 * requester half for what they're missing and the server half for what
 * they're asked. Symmetry is what removes the negotiation problem, not a
 * protocol added to solve it.
 *
 * What this class *does* solve, because the wire protocol doesn't: when to
 * connect, how many peers to talk to at once, how long to stay connected to
 * one before giving another a turn, and when to give up and retry. See
 * [onPeerSeen] for the per-peer state machine.
 *
 * Known v0 limitation, inherited from [BleGattTransport]/`serveChunk`'s own
 * documented boundary: there is no persisted partial-chunk state, so a
 * TRANSFER interrupted by a real disconnect (the contact window closing) is
 * not resumed mid-session — it simply restarts from byte 0 the next time
 * these two peers meet and sync again. Cross-contact byte-level resume only
 * exists today for a transfer kept alive on one still-open connection.
 */
class AutoPeerSyncEngine(
    private val transport: PeerTransport,
    /** This node's own id, for logging only — the HELLO's `node_id` comes from [localSummaryProvider]. */
    private val localNodeId: String,
    /** Builds this node's full HELLO (all datasets held), typically `MeshRepository.allLocalPeerSummaries`. */
    private val localSummaryProvider: suspend () -> JSONObject,
    /** Looks up a cached chunk-v0 payload to serve a REQUEST, or null if this node doesn't have it. */
    private val chunkProvider: suspend (datasetId: String, namespace: String, chunkId: String) -> JSONObject?,
    /** Verifies and applies a received chunk-v0 payload, typically `MeshRepository.ingestChunk`. */
    private val chunkIngestor: suspend (JSONObject) -> ChunkIngestResult,
    private val scope: CoroutineScope,
    private val onLog: (String) -> Unit = {},
    private val maxConcurrentSessions: Int = MAX_CONCURRENT_SESSIONS,
    private val connectTimeoutMillis: Long = CONNECT_TIMEOUT_MS,
    private val helloTimeoutMillis: Long = HELLO_TIMEOUT_MS,
    private val requestedChunkTimeoutMillis: Long = REQUESTED_CHUNK_TIMEOUT_MS,
    private val receptiveWindowMillis: Long = RECEPTIVE_WINDOW_MS,
    private val syncCooldownMillis: Long = SYNC_COOLDOWN_MS,
    private val failureCooldownMillis: Long = FAILURE_COOLDOWN_MS,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private enum class Phase {
        DISCOVERED, CONNECTING, EXCHANGING, SYNCED, FAILED;

        fun isBusy() = this == CONNECTING || this == EXCHANGING
    }

    /**
     * Per-peer negotiation state. One instance is reused across repeated
     * encounters with the same peer (survives cooldown) so [retryNotBeforeMillis]
     * and the HELLO sequence number keep meaning across attempts.
     *
     * [recordHello]/[takeUnconsumedHello] track "has a HELLO arrived since I
     * last acted on one" with a plain counter rather than a timestamp or a
     * one-shot `CompletableDeferred` — a peer's HELLO can legitimately arrive
     * before this side's own [onPeerSeen] ever fires for them (both sides
     * discover and connect independently), so a deferred reset at the start
     * of each attempt would race with, and could discard, a HELLO that
     * arrived just before the reset.
     */
    private class PeerSession(val peerId: String) {
        @Volatile var phase: Phase = Phase.DISCOVERED
        @Volatile var connection: Connection? = null
        @Volatile var retryNotBeforeMillis: Long = 0L
        @Volatile var lastSeenAtMillis: Long = 0L

        @Volatile private var latestRemoteSummary: PeerSummary? = null
        private val remoteSummarySeq = AtomicLong(0)
        @Volatile private var helloConsumedSeq: Long = 0L

        fun recordHello(summary: PeerSummary) {
            latestRemoteSummary = summary
            remoteSummarySeq.incrementAndGet()
        }

        /** Returns the latest HELLO if it hasn't already been acted on this round, else null. */
        fun takeUnconsumedHello(): PeerSummary? {
            val seq = remoteSummarySeq.get()
            if (seq <= helloConsumedSeq) return null
            helloConsumedSeq = seq
            return latestRemoteSummary
        }

        val pendingByChunkId = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

        /** REQUESTs that arrived before [connection] was set — see [drainBufferedRequests]. */
        val bufferedRequests = ConcurrentLinkedQueue<JSONObject>()
    }

    data class Stats(val peersSynced: Int, val chunksApplied: Int, val activeSessions: Int)

    private val sessions = ConcurrentHashMap<String, PeerSession>()
    private val semaphore = Semaphore(maxConcurrentSessions)
    private var discoverJob: Job? = null
    private var receiveJob: Job? = null

    private val peersSyncedCounter = AtomicInteger(0)
    private val chunksAppliedCounter = AtomicInteger(0)

    fun start() {
        onLog("AutoPeerSyncEngine starting as $localNodeId")
        receiveJob = scope.launch {
            transport.receivedMessages.collect { (peerId, bytes) ->
                runCatching { handleIncoming(peerId, bytes) }
                    .onFailure { onLog("error handling message from $peerId: ${it.message}") }
            }
        }
        discoverJob = scope.launch {
            transport.discover().collect { advertisement -> onPeerSeen(advertisement.peerId) }
        }
    }

    /** Cancels discovery/receive collection. Does not close GATT connections — call `transport.teardown()` for that. */
    fun stop() {
        discoverJob?.cancel()
        receiveJob?.cancel()
        sessions.clear()
    }

    fun stats(): Stats = Stats(
        peersSynced = peersSyncedCounter.get(),
        chunksApplied = chunksAppliedCounter.get(),
        activeSessions = sessions.values.count { it.phase.isBusy() },
    )

    /**
     * How many peers have had an advertisement seen within [staleAfterMillis].
     * `EmergencyModeService`'s notification wants this to show "N peers
     * nearby" — it can't collect `transport.discover()` a second time to get
     * it independently, because [PeerTransport.discover] is a per-collection
     * side-effecting flow (advertising/scanning restart on every collection,
     * see `BleGattTransport`'s own doc comment), so this engine — the flow's
     * one and only collector — is the only place that count can come from.
     */
    fun visiblePeerCount(staleAfterMillis: Long): Int {
        val now = clock()
        return sessions.values.count { now - it.lastSeenAtMillis <= staleAfterMillis }
    }

    private fun onPeerSeen(peerId: String) {
        val session = sessions.computeIfAbsent(peerId) { PeerSession(it) }
        session.lastSeenAtMillis = clock()
        val started = synchronized(session) {
            if (!shouldAttemptSync(clock(), session.retryNotBeforeMillis, session.phase.isBusy())) return@synchronized false
            session.phase = Phase.CONNECTING
            true
        }
        if (!started) return

        if (!semaphore.tryAcquire()) {
            // At capacity — this peer stays DISCOVERED and will be retried
            // the next time its advertisement is (re)seen, which BLE does
            // every few hundred ms while it's still nearby.
            session.phase = Phase.DISCOVERED
            return
        }
        scope.launch {
            try {
                runSession(session)
            } finally {
                semaphore.release()
            }
        }
    }

    private suspend fun runSession(session: PeerSession) {
        val peerId = session.peerId
        session.pendingByChunkId.entries.removeIf { it.value.isCompleted }
        try {
            val conn = withTimeoutOrNull(connectTimeoutMillis) { transport.connect(peerId) }
            if (conn == null) {
                onLog("connect timeout/failed for $peerId")
                fail(session)
                return
            }
            session.connection = conn
            session.phase = Phase.EXCHANGING
            onLog("connected to $peerId")
            drainBufferedRequests(session)

            val localSummaryJson = localSummaryProvider()
            if (!sendEnvelope(conn, JSONObject().put("type", "HELLO").put("summary", localSummaryJson))) {
                fail(session)
                return
            }

            val remoteSummary = withTimeoutOrNull(helloTimeoutMillis) {
                var summary = session.takeUnconsumedHello()
                while (summary == null) {
                    delay(HELLO_POLL_INTERVAL_MS)
                    summary = session.takeUnconsumedHello()
                }
                summary
            }
            if (remoteSummary == null) {
                onLog("no HELLO from $peerId within timeout")
                fail(session)
                return
            }

            val localSummary = PeerSummary.fromJson(localSummaryJson)
            val requests = buildRequestsForMissingData(localSummary, remoteSummary)
            for (request in requests) {
                for (chunk in request.chunks) session.pendingByChunkId[chunk.chunkId] = CompletableDeferred()
                if (sendEnvelope(conn, JSONObject().put("type", "REQUEST").put("request", request.toEnvelopeJson()))) {
                    onLog("sent REQUEST to $peerId for ${request.chunks.map { it.chunkId }}")
                }
            }
            if (requests.isEmpty()) onLog("nothing to request from $peerId, already in sync")

            // Stay connected long enough for our own REQUESTs to resolve
            // (bounded by requestedChunkTimeoutMillis) and at least
            // receptiveWindowMillis regardless, so a peer with nothing to
            // request from *us* still gets a window to ask.
            coroutineScope {
                val pending = session.pendingByChunkId.values.toList()
                val allRequestedDone = async {
                    if (pending.isEmpty()) true
                    else withTimeoutOrNull(requestedChunkTimeoutMillis) { pending.awaitAll(); true } ?: false
                }
                delay(receptiveWindowMillis)
                allRequestedDone.await()
            }

            session.phase = Phase.SYNCED
            session.retryNotBeforeMillis = clock() + syncCooldownMillis
            peersSyncedCounter.incrementAndGet()
            onLog("sync with $peerId complete")
        } catch (e: Exception) {
            onLog("session with $peerId failed: ${e.message}")
            fail(session)
        } finally {
            val conn = session.connection
            session.connection = null
            if (conn != null) {
                withContext(NonCancellable) { runCatching { transport.close(conn) } }
            }
        }
    }

    private fun fail(session: PeerSession) {
        session.phase = Phase.FAILED
        session.retryNotBeforeMillis = clock() + failureCooldownMillis
    }

    /**
     * `PeerSync.computeDiff` requires both sides to already carry an entry
     * for the dataset — a reasonable contract for a pure module that must
     * stay byte-identical to `pipeline/lib/peer-sync.mjs`. But this node has
     * no advance knowledge of every dataset a stranger might carry, and
     * `MeshRepository.allLocalPeerSummaries` only ever declares datasets
     * this node has *something* for — so "no local entry" here legitimately
     * means "I don't have this at all", not a bug worth pushing into the
     * shared pure module. Handled one layer up instead: synthesize exactly
     * what `computeDiff` would compute for a local dataset with an empty
     * chunk list.
     */
    private fun diffAgainstLocal(local: PeerSummary, remote: PeerSummary, remoteDataset: DatasetSummary) =
        if (local.datasets.none { it.datasetId == remoteDataset.datasetId && it.namespace == remoteDataset.namespace }) {
            DiffResult(
                datasetId = remoteDataset.datasetId,
                namespace = remoteDataset.namespace,
                manifestId = remoteDataset.manifestId,
                missingChunks = remoteDataset.chunks.map { ChunkRef(it.chunkId, it.chunkHash, it.sizeBytes, it.priority) },
                staleChunks = emptyList(),
                supersededManifestId = null,
            )
        } else {
            PeerSync.computeDiff(local, remote, remoteDataset.datasetId, remoteDataset.namespace)
        }

    private fun buildRequestsForMissingData(local: PeerSummary, remote: PeerSummary): List<RequestMessage> =
        remote.datasets.mapNotNull { remoteDataset ->
            val diff = try {
                diffAgainstLocal(local, remote, remoteDataset)
            } catch (e: PeerSyncException) {
                onLog("diff failed for ${remoteDataset.namespace}/${remoteDataset.datasetId}: ${e.message}")
                return@mapNotNull null
            }
            if (diff.missingChunks.isEmpty() && diff.staleChunks.isEmpty()) null else PeerSync.buildRequest(diff)
        }

    private suspend fun handleIncoming(peerId: String, bytes: ByteArray) {
        val envelope = try {
            JSONObject(String(bytes, StandardCharsets.UTF_8))
        } catch (e: Exception) {
            onLog("received non-JSON payload from $peerId (${bytes.size} bytes), ignoring")
            return
        }
        val session = sessions.computeIfAbsent(peerId) { PeerSession(it) }
        when (envelope.optString("type")) {
            "HELLO" -> session.recordHello(PeerSummary.fromJson(envelope.getJSONObject("summary")))
            "REQUEST" -> handleRequest(session, envelope.getJSONObject("request"))
            "TRANSFER" -> handleTransfer(session, envelope.getJSONObject("chunk"))
            else -> onLog("unknown envelope type from $peerId: ${envelope.optString("type")}")
        }
    }

    private suspend fun handleRequest(session: PeerSession, requestJson: JSONObject) {
        val conn = session.connection
        if (conn == null) {
            // Our own connect() to this peer hasn't finished yet — drained
            // by drainBufferedRequests once it does. See PeerSyncMilestoneActivity's
            // pendingRemoteSummaryJson for the same two-sided race on HELLO.
            session.bufferedRequests.add(requestJson)
            return
        }
        serveRequest(conn, requestJson)
    }

    private fun drainBufferedRequests(session: PeerSession) {
        val conn = session.connection ?: return
        generateSequence { session.bufferedRequests.poll() }.forEach { requestJson ->
            scope.launch { serveRequest(conn, requestJson) }
        }
    }

    private suspend fun serveRequest(conn: Connection, requestJson: JSONObject) {
        val datasetId = requestJson.getString("dataset_id")
        val namespace = requestJson.getString("namespace")
        val chunksRequested = requestJson.getJSONArray("chunks")
        for (i in 0 until chunksRequested.length()) {
            val chunkId = chunksRequested.getJSONObject(i).getString("chunk_id")
            val chunkJson = chunkProvider(datasetId, namespace, chunkId)
            if (chunkJson == null) {
                onLog("asked for $chunkId but it's not in the local cache, skipping")
                continue
            }
            val payload = JSONObject().put("type", "TRANSFER").put("chunk", chunkJson)
                .toString().toByteArray(StandardCharsets.UTF_8)
            when (val result = transport.send(conn, payload)) {
                is TransferResult.Success -> onLog("sent TRANSFER for $chunkId, ${result.bytesTransferred} bytes")
                is TransferResult.Interrupted -> onLog("TRANSFER for $chunkId interrupted at ${result.bytesTransferred} bytes")
                is TransferResult.Failed -> onLog("TRANSFER for $chunkId failed: ${result.reason}")
            }
        }
    }

    private suspend fun handleTransfer(session: PeerSession, chunkJson: JSONObject) {
        val chunkId = chunkJson.optString("chunk_id")
        when (val result = chunkIngestor(chunkJson)) {
            is ChunkIngestResult.Applied -> {
                chunksAppliedCounter.addAndGet(result.eventResults.size)
                onLog("applied TRANSFER for $chunkId, ${result.eventResults.size} event(s)")
            }
            is ChunkIngestResult.Rejected -> onLog("rejected TRANSFER for $chunkId: ${result.reason}")
        }
        session.pendingByChunkId[chunkId]?.complete(true)
    }

    private suspend fun sendEnvelope(conn: Connection, envelope: JSONObject): Boolean =
        when (val result = transport.send(conn, envelope.toString().toByteArray(StandardCharsets.UTF_8))) {
            is TransferResult.Success -> true
            else -> {
                onLog("send FAILED for envelope type=${envelope.optString("type")}: $result")
                false
            }
        }

    private fun RequestMessage.toEnvelopeJson(): JSONObject {
        val chunksArray = JSONArray()
        for (c in chunks) {
            chunksArray.put(
                JSONObject()
                    .put("chunk_id", c.chunkId)
                    .put("chunk_hash", c.chunkHash)
                    .put("priority", c.priority.name)
                    .put("offset_bytes", c.offsetBytes)
                    .put("max_bytes", c.maxBytes),
            )
        }
        return JSONObject()
            .put("dataset_id", datasetId)
            .put("namespace", namespace)
            .put("manifest_id", manifestId)
            .put("chunks", chunksArray)
            .put("resume", resume)
            .put("max_total_bytes", maxTotalBytes)
            .apply { supersededManifestId?.let { put("superseded_manifest_id", it) } }
    }

    companion object {
        private const val MAX_CONCURRENT_SESSIONS = 2
        private const val CONNECT_TIMEOUT_MS = 15_000L
        private const val HELLO_TIMEOUT_MS = 10_000L
        private const val HELLO_POLL_INTERVAL_MS = 200L
        private const val REQUESTED_CHUNK_TIMEOUT_MS = 20_000L
        private const val RECEPTIVE_WINDOW_MS = 6_000L

        /** A peer we just finished syncing with isn't retried until this much later. */
        private const val SYNC_COOLDOWN_MS = 60_000L

        /** Shorter than [SYNC_COOLDOWN_MS]: a failed attempt (unreachable peer, timeout) is worth retrying sooner. */
        private const val FAILURE_COOLDOWN_MS = 15_000L

        /**
         * Decides whether a (re)discovered peer is worth attempting now. Pure
         * and side-effect-free on purpose, and a companion function rather
         * than an instance method so it's unit-testable without constructing
         * an engine — this is the one piece of "when do we act" policy worth
         * exercising directly, without any coroutines, transports, or timing.
         */
        internal fun shouldAttemptSync(now: Long, retryNotBeforeMillis: Long, sessionBusy: Boolean): Boolean =
            !sessionBusy && now >= retryNotBeforeMillis
    }
}
