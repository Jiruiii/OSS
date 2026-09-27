package com.resilientgeo.mesh.emergency

import com.resilientgeo.mesh.data.ChunkIngestResult
import com.resilientgeo.mesh.ingest.ApplyState
import com.resilientgeo.mesh.ingest.IngestResult
import com.resilientgeo.mesh.protocol.ChunkVerifier
import com.resilientgeo.mesh.report.CrowdChunkCodec
import com.resilientgeo.mesh.trust.CrowdFixtures
import com.resilientgeo.mesh.trust.TrustedKeyStore
import com.resilientgeo.mesh.transport.Connection
import com.resilientgeo.mesh.transport.PeerAdvertisement
import com.resilientgeo.mesh.transport.PeerTransport
import com.resilientgeo.mesh.transport.TransferResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Proves the "no role negotiation needed" design (see AutoPeerSyncEngine's
 * doc comment) deterministically on the JVM: two engines wired to each other
 * through [FakeMedium], neither told which one is requester or server, both
 * ending up in sync — the same shape of proof `docs/mvp-remaining-tasks.md`
 * item 4 did on real hardware for the human-driven demo, but for the
 * automatic path and without needing a second physical device.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class AutoPeerSyncEngineTest {

    @Test fun `server stays connected until a large outgoing transfer finishes`() = runTest {
        val medium = FakeMedium()
        val a = FakeTransport("large-client", medium)
        val b = FakeTransport("large-server", medium)
        medium.register(a); medium.register(b)
        var serverClosed = false
        val slowServer = object : PeerTransport by b {
            override suspend fun send(connection: Connection, payload: ByteArray): TransferResult {
                if (JSONObject(String(payload)).getString("type") == "TRANSFER") {
                    delay(1500)
                    assertFalse("Server disconnected during its outgoing transfer", serverClosed)
                }
                return b.send(connection, payload)
            }
            override suspend fun close(connection: Connection) { serverClosed = true; b.close(connection) }
        }
        val chunk = JSONObject().put("dataset_id", "demo").put("namespace", "official")
            .put("chunk_id", "demo:chunk:large").put("chunk_hash", "sha256:fake").put("size_bytes", 2048)
        val client = AutoPeerSyncEngine(a, "client", { summaryJson("client", emptyList()) }, { _, _, _ -> null },
            { ChunkIngestResult.Applied(emptyList()) }, backgroundScope,
            requestedChunkTimeoutMillis = 1000, receptiveWindowMillis = 100)
        val server = AutoPeerSyncEngine(slowServer, "server", { summaryJson("server", listOf(chunk)) }, { _, _, _ -> chunk },
            { ChunkIngestResult.Applied(emptyList()) }, backgroundScope, receptiveWindowMillis = 100)
        client.start(); server.start(); runCurrent()
        a.advertise(b.peerId); b.advertise(a.peerId); runCurrent()
        advanceTimeBy(500); runCurrent()
        assertFalse(serverClosed)
        assertEquals(0, server.stats().peersSynced)
        advanceTimeBy(1600); runCurrent()
        assertEquals(1, client.stats().chunksApplied)
        assertEquals(1, client.stats().peersSynced)
        assertEquals(1, server.stats().peersSynced)
        client.stop(); server.stop()
    }

    @Test fun `discovery failure is reported without claiming a successful sync`() = runTest {
        val radio = FakeTransport("failed", FakeMedium())
        val failed = object : PeerTransport by radio {
            override fun discover(): Flow<PeerAdvertisement> = kotlinx.coroutines.flow.flow { throw IllegalStateException("scan failed") }
        }
        val outcomes = mutableListOf<AutoPeerSyncEngine.SyncOutcome>()
        val engine = AutoPeerSyncEngine(failed, "node", { summaryJson("node", emptyList()) }, { _, _, _ -> null }, { ChunkIngestResult.Rejected("unused") }, backgroundScope, onSyncOutcome = { outcomes += it })
        engine.start()
        runCurrent()
        assertEquals(listOf(AutoPeerSyncEngine.SyncOutcome(false, "discovery_failed")), outcomes)
        assertEquals(0, engine.stats().peersSynced)
        engine.stop()
    }

    @Test
    fun `advertised and incoming private addresses map to the same transport session`() = runTest {
        val medium = FakeMedium()
        val a = FakeTransport("advertised-a", medium, "ble:aaaaaaaaaaaaaaaa", "private-a")
        val b = FakeTransport("advertised-b", medium, "ble:bbbbbbbbbbbbbbbb", "private-b")
        medium.register(a)
        medium.register(b)
        val chunk = JSONObject().put("dataset_id", "demo").put("namespace", "official")
            .put("chunk_id", "demo:chunk:identity").put("chunk_hash", "sha256:fake").put("size_bytes", 10)
        val held = ConcurrentHashMap<String, JSONObject>()
        val outcomes = mutableListOf<AutoPeerSyncEngine.SyncOutcome>()
        val engineA = AutoPeerSyncEngine(a, "node-a", { summaryJson("node-a", held.values.toList()) },
            { _, _, id -> held[id] }, { received ->
                held[received.getString("chunk_id")] = received
                ChunkIngestResult.Applied(listOf(IngestResult.Inserted(false, ApplyState.CURRENT)))
            }, backgroundScope, receptiveWindowMillis = 100, onSyncOutcome = { outcomes += it })
        val engineB = AutoPeerSyncEngine(b, "node-b", { summaryJson("node-b", listOf(chunk)) },
            { _, _, _ -> chunk }, { ChunkIngestResult.Applied(emptyList()) },
            backgroundScope, receptiveWindowMillis = 100)
        engineA.start()
        engineB.start()
        runCurrent()
        a.advertise(b.peerId)
        b.advertise(a.peerId)
        settle()
        assertTrue(held.containsKey("demo:chunk:identity"))
        assertEquals(1, engineA.stats().peersSynced)
        assertEquals(1, engineB.stats().peersSynced)
        assertEquals(listOf(AutoPeerSyncEngine.SyncOutcome(true)), outcomes)
        engineA.stop()
        engineB.stop()
    }

    @Test
    fun `rejected transfers and missing cache timeouts do not count as successful syncs`() = runTest {
        for (missingCache in listOf(false, true)) {
            val medium = FakeMedium()
            val nodeA = FakeTransport("requester-$missingCache", medium)
            val nodeB = FakeTransport("server-$missingCache", medium)
            medium.register(nodeA)
            medium.register(nodeB)
            val chunk = JSONObject().put("dataset_id", "demo").put("namespace", "official")
                .put("chunk_id", "demo:chunk:failure").put("chunk_hash", "sha256:fake").put("size_bytes", 10)
            val logs = mutableListOf<String>()
            val outcomes = mutableListOf<AutoPeerSyncEngine.SyncOutcome>()
            val engineA = AutoPeerSyncEngine(nodeA, "requester",
                { summaryJson("requester", emptyList()) }, { _, _, _ -> null },
                { ChunkIngestResult.Rejected("bad signature") }, backgroundScope, onLog = { logs += it },
                helloTimeoutMillis = 1000, requestedChunkTimeoutMillis = 1000, receptiveWindowMillis = 100,
                onSyncOutcome = { outcomes += it })
            val engineB = AutoPeerSyncEngine(nodeB, "server",
                { summaryJson("server", listOf(chunk)) }, { _, _, _ -> if (missingCache) null else chunk },
                { ChunkIngestResult.Applied(emptyList()) }, backgroundScope,
                helloTimeoutMillis = 1000, requestedChunkTimeoutMillis = 1000, receptiveWindowMillis = 100)
            engineA.start()
            engineB.start()
            runCurrent()
            nodeA.advertise(nodeB.peerId)
            nodeB.advertise(nodeA.peerId)
            advanceTimeBy(1500)
            runCurrent()
            assertEquals(0, engineA.stats().peersSynced)
            assertEquals(0, engineA.stats().chunksApplied)
            assertTrue(logs.any { it.contains("incomplete") })
            assertEquals(listOf(AutoPeerSyncEngine.SyncOutcome(false, "transfer_incomplete")), outcomes)
            engineA.stop()
            engineB.stop()
        }
    }

    // --- pure scheduling policy, no coroutines involved ---

    @Test
    fun `shouldAttemptSync allows a never-attempted peer`() {
        assertTrue(AutoPeerSyncEngine.shouldAttemptSync(now = 1_000L, retryNotBeforeMillis = 0L, sessionBusy = false))
    }

    @Test
    fun `shouldAttemptSync refuses a peer whose session is already active`() {
        assertFalse(AutoPeerSyncEngine.shouldAttemptSync(now = 1_000L, retryNotBeforeMillis = 0L, sessionBusy = true))
    }

    @Test
    fun `shouldAttemptSync refuses a peer still in cooldown`() {
        assertFalse(AutoPeerSyncEngine.shouldAttemptSync(now = 1_000L, retryNotBeforeMillis = 5_000L, sessionBusy = false))
    }

    @Test
    fun `shouldAttemptSync allows a peer once its cooldown has elapsed`() {
        assertTrue(AutoPeerSyncEngine.shouldAttemptSync(now = 5_000L, retryNotBeforeMillis = 5_000L, sessionBusy = false))
    }

    // --- end-to-end: two engines, no fixed roles, wired via an in-memory medium ---

    @Test
    fun `two engines sync symmetrically with no assigned roles`() = runTest {
        val medium = FakeMedium()
        val nodeA = FakeTransport("node-a-addr", medium)
        val nodeB = FakeTransport("node-b-addr", medium)
        medium.register(nodeA)
        medium.register(nodeB)

        // Node A starts with nothing; Node B already holds one CRITICAL chunk.
        val nodeAChunks = ConcurrentHashMap<String, JSONObject>()
        val nodeBChunks = ConcurrentHashMap<String, JSONObject>()
        val chunkId = "demo:chunk:0"
        nodeBChunks[chunkId] = JSONObject()
            .put("dataset_id", "demo")
            .put("namespace", "official")
            .put("chunk_id", chunkId)
            .put("chunk_hash", "sha256:fake")
            .put("size_bytes", 10)

        val appliedOnA = mutableListOf<String>()

        val engineA = AutoPeerSyncEngine(
            transport = nodeA,
            localNodeId = "node-a",
            localSummaryProvider = { summaryJson("node-a", nodeAChunks.values.toList()) },
            chunkProvider = { _, _, id -> nodeAChunks[id] },
            chunkIngestor = { chunk ->
                nodeAChunks[chunk.getString("chunk_id")] = chunk
                appliedOnA += chunk.getString("chunk_id")
                // One received chunk counts once even when it contains several events.
                ChunkIngestResult.Applied(List(2) { IngestResult.Inserted(insertedIntoSeparateNamespace = false, state = ApplyState.CURRENT) })
            },
            scope = backgroundScope,
            connectTimeoutMillis = 1_000,
            helloTimeoutMillis = 1_000,
            requestedChunkTimeoutMillis = 2_000,
            receptiveWindowMillis = 200,
        )
        val engineB = AutoPeerSyncEngine(
            transport = nodeB,
            localNodeId = "node-b",
            localSummaryProvider = { summaryJson("node-b", nodeBChunks.values.toList()) },
            chunkProvider = { _, _, id -> nodeBChunks[id] },
            chunkIngestor = { chunk -> ChunkIngestResult.Applied(emptyList()) },
            scope = backgroundScope,
            connectTimeoutMillis = 1_000,
            helloTimeoutMillis = 1_000,
            requestedChunkTimeoutMillis = 2_000,
            receptiveWindowMillis = 200,
        )

        engineA.start()
        engineB.start()
        // start() only queues the collectors under runTest's StandardTestDispatcher;
        // let them subscribe before advertising, or the SharedFlow drops the emissions.
        runCurrent()

        // Neither side is told it's the requester or the server — both just
        // see the other's advertisement, exactly like two strangers' phones
        // discovering each other over real BLE.
        nodeA.advertise(nodeB.peerId)
        nodeB.advertise(nodeA.peerId)
        settle()

        assertEquals(listOf(chunkId), appliedOnA)
        assertEquals(1, engineA.stats().peersSynced)
        assertEquals(1, engineB.stats().peersSynced)
        assertEquals(1, engineA.stats().chunksApplied)
    }

    @Test
    fun `a synced peer is not reconnected to during its cooldown window`() = runTest {
        val medium = FakeMedium()
        val nodeA = FakeTransport("node-a-addr", medium)
        val nodeB = FakeTransport("node-b-addr", medium)
        medium.register(nodeA)
        medium.register(nodeB)

        var fakeNow = 0L
        val engineA = AutoPeerSyncEngine(
            transport = nodeA,
            localNodeId = "node-a",
            localSummaryProvider = { summaryJson("node-a", emptyList()) },
            chunkProvider = { _, _, _ -> null },
            chunkIngestor = { ChunkIngestResult.Applied(emptyList()) },
            scope = backgroundScope,
            connectTimeoutMillis = 1_000,
            helloTimeoutMillis = 1_000,
            requestedChunkTimeoutMillis = 1_000,
            receptiveWindowMillis = 100,
            syncCooldownMillis = 60_000,
            clock = { fakeNow },
        )
        val engineB = AutoPeerSyncEngine(
            transport = nodeB,
            localNodeId = "node-b",
            localSummaryProvider = { summaryJson("node-b", emptyList()) },
            chunkProvider = { _, _, _ -> null },
            chunkIngestor = { ChunkIngestResult.Applied(emptyList()) },
            scope = backgroundScope,
            connectTimeoutMillis = 1_000,
            helloTimeoutMillis = 1_000,
            requestedChunkTimeoutMillis = 1_000,
            receptiveWindowMillis = 100,
            clock = { fakeNow },
        )
        engineA.start()
        engineB.start()
        // start() only queues the collectors under runTest's StandardTestDispatcher;
        // let them subscribe before advertising, or the SharedFlow drops the emissions.
        runCurrent()

        nodeA.advertise(nodeB.peerId)
        nodeB.advertise(nodeA.peerId)
        settle()
        assertEquals(1, engineA.stats().peersSynced)
        assertEquals(1, nodeA.connectCount.get())

        // Re-seeing the same peer immediately, still within cooldown, must
        // not trigger a second connect().
        nodeA.advertise(nodeB.peerId)
        settle()
        assertEquals(1, nodeA.connectCount.get())

        // Advancing past the cooldown window allows a new attempt.
        fakeNow += 60_000
        nodeA.advertise(nodeB.peerId)
        settle()
        assertEquals(2, nodeA.connectCount.get())
    }

    @Test
    fun `a crowd report travels A to B to C unchanged, and a tampered one stops at B`() = runTest {
        val medium = FakeMedium()
        val transports = listOf("a", "b", "c").associateWith { FakeTransport("node-$it-addr", medium).also(medium::register) }
        val held = listOf("a", "b", "c").associateWith { ConcurrentHashMap<String, JSONObject>() }
        val report = CrowdFixtures.chunkCase("valid_chunk").getJSONObject("chunk")
        val forged = CrowdFixtures.chunkCase("relay_tampered").getJSONObject("chunk")
            .put("chunk_id", "crowd:report:forged")
        held.getValue("a")[report.getString("chunk_id")] = JSONObject(report.toString())
        // A also advertises a report it rewrote; B must refuse to hold or relay it.
        held.getValue("a")[forged.getString("chunk_id")] = forged
        val rejectedOnB = mutableListOf<String>()

        fun engine(name: String) = AutoPeerSyncEngine(
            transport = transports.getValue(name),
            localNodeId = "node-$name",
            localSummaryProvider = { crowdSummaryJson("node-$name", held.getValue(name).values.toList()) },
            chunkProvider = { _, _, id -> held.getValue(name)[id] },
            chunkIngestor = { chunk ->
                when (val verified = ChunkVerifier.verify(chunk, TrustedKeyStore(emptyMap()), CrowdFixtures.now)) {
                    is ChunkVerifier.Result.Valid -> {
                        held.getValue(name)[chunk.getString("chunk_id")] = chunk
                        ChunkIngestResult.Applied(emptyList())
                    }
                    is ChunkVerifier.Result.Invalid -> {
                        if (name == "b") rejectedOnB += verified.reason
                        ChunkIngestResult.Rejected(verified.reason)
                    }
                }
            },
            scope = backgroundScope,
            connectTimeoutMillis = 1_000,
            helloTimeoutMillis = 1_000,
            requestedChunkTimeoutMillis = 2_000,
            receptiveWindowMillis = 200,
        )
        val engines = listOf("a", "b", "c").associateWith(::engine)
        engines.values.forEach { it.start() }
        // start() only queues the collectors under runTest's StandardTestDispatcher;
        // let them subscribe before advertising, or the SharedFlow drops the emissions.
        runCurrent()

        // A meets B; C is out of range.
        transports.getValue("a").advertise("node-b-addr")
        transports.getValue("b").advertise("node-a-addr")
        settle()
        assertTrue(held.getValue("b").containsKey(report.getString("chunk_id")))
        assertFalse(held.getValue("b").containsKey(forged.getString("chunk_id")))
        assertEquals(listOf("crowd_chunk_binding_invalid"), rejectedOnB)
        assertFalse(held.getValue("c").containsKey(report.getString("chunk_id")))

        // Later B walks to C; A is gone.
        transports.getValue("b").advertise("node-c-addr")
        transports.getValue("c").advertise("node-b-addr")
        settle()

        val relayed = held.getValue("c").getValue(report.getString("chunk_id"))
        assertEquals(report.toString(), relayed.toString())
        assertEquals(
            CrowdFixtures.root.getString("device_key_id"),
            relayed.getJSONArray("events").getJSONObject(0).getString("signing_key_id"),
        )
        assertFalse(held.getValue("c").containsKey(forged.getString("chunk_id")))
    }

    /**
     * The engines run entirely in backgroundScope, and advanceUntilIdle() does
     * not wait for background work, so drive virtual time past every engine
     * timeout instead.
     */
    private fun TestScope.settle() {
        advanceTimeBy(SETTLE_MILLIS)
        runCurrent()
    }

    private companion object {
        const val SETTLE_MILLIS = 30_000L
    }

    private fun crowdSummaryJson(nodeId: String, chunks: List<JSONObject>): JSONObject {
        val chunksArray = JSONArray()
        chunks.sortedBy { it.getString("chunk_id") }.forEach { chunk ->
            chunksArray.put(
                JSONObject()
                    .put("chunk_id", chunk.getString("chunk_id"))
                    .put("chunk_hash", chunk.getString("chunk_hash"))
                    .put("size_bytes", chunk.getLong("byte_length"))
                    .put("priority", chunk.getString("priority")),
            )
        }
        val dataset = JSONObject()
            .put("dataset_id", CrowdChunkCodec.DATASET_ID)
            .put("namespace", CrowdChunkCodec.NAMESPACE)
            .put("manifest_id", CrowdChunkCodec.MANIFEST_ID)
            .put("dataset_version", CrowdChunkCodec.DATASET_VERSION)
            .put("chunks", chunksArray)
        return JSONObject()
            .put("node_id", nodeId)
            .put("datasets", JSONArray().put(dataset))
    }

    private fun summaryJson(nodeId: String, chunks: List<JSONObject>): JSONObject {
        val chunksArray = JSONArray()
        chunks.forEach { chunk ->
            chunksArray.put(
                JSONObject()
                    .put("chunk_id", chunk.getString("chunk_id"))
                    .put("chunk_hash", chunk.getString("chunk_hash"))
                    .put("size_bytes", chunk.getLong("size_bytes"))
                    .put("priority", "CRITICAL"),
            )
        }
        val dataset = JSONObject()
            .put("dataset_id", "demo")
            .put("namespace", "official")
            .put("manifest_id", "demo:manifest:1")
            .put("dataset_version", 1)
            .put("chunks", chunksArray)
        return JSONObject()
            .put("node_id", nodeId)
            .put("datasets", JSONArray().put(dataset))
    }

    /** Routes [FakeTransport.send] payloads between registered fakes by peer id. */
    private class FakeMedium {
        private val transports = ConcurrentHashMap<String, FakeTransport>()

        fun register(transport: FakeTransport) {
            transports[transport.peerId] = transport
        }

        fun identityOf(peerId: String): String? = transports[peerId]?.localIdentity

        fun deliver(to: String, from: String, payload: ByteArray) {
            transports[to]?.receive(from, payload)
        }
    }

    /**
     * Minimal [PeerTransport] with no real BLE: `connect()` always succeeds
     * immediately, and `send()` hands the payload straight to the addressed
     * fake's `receivedMessages` flow via [FakeMedium] — enough to exercise
     * AutoPeerSyncEngine's negotiation logic without any Android/BLE stack.
     */
    private class FakeTransport(
        val peerId: String,
        private val medium: FakeMedium,
        override val localIdentity: String? = null,
        private val incomingAddress: String = peerId,
    ) : PeerTransport {
        private val discoverFlow = MutableSharedFlow<PeerAdvertisement>(extraBufferCapacity = 64)
        private val received = MutableSharedFlow<Pair<String, ByteArray>>(extraBufferCapacity = 64)
        override val receivedMessages: SharedFlow<Pair<String, ByteArray>> get() = received

        val connectCount = AtomicInteger(0)

        override fun discover(): Flow<PeerAdvertisement> = discoverFlow

        override suspend fun connect(peerId: String): Connection {
            connectCount.incrementAndGet()
            return Connection(peerId = peerId, connectionId = peerId)
        }

        override suspend fun send(connection: Connection, payload: ByteArray): TransferResult {
            medium.deliver(to = connection.peerId, from = incomingAddress, payload)
            return TransferResult.Success(bytesTransferred = payload.size.toLong(), durationMillis = 0)
        }

        override suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult =
            send(connection, payload)

        override suspend fun close(connection: Connection) = Unit

        fun receive(from: String, payload: ByteArray) {
            received.tryEmit(from to payload)
        }

        fun advertise(peerId: String) {
            discoverFlow.tryEmit(PeerAdvertisement(peerId = peerId, rssi = null, discoveredAtMillis = 0, transportIdentity = medium.identityOf(peerId)))
        }
    }
}
