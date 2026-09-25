package com.resilientgeo.mesh.emergency

import com.resilientgeo.mesh.data.ChunkIngestResult
import com.resilientgeo.mesh.transport.Connection
import com.resilientgeo.mesh.transport.PeerAdvertisement
import com.resilientgeo.mesh.transport.PeerTransport
import com.resilientgeo.mesh.transport.TransferResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
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
class AutoPeerSyncEngineTest {

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
                ChunkIngestResult.Applied(emptyList())
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

        // Neither side is told it's the requester or the server — both just
        // see the other's advertisement, exactly like two strangers' phones
        // discovering each other over real BLE.
        nodeA.advertise(nodeB.peerId)
        nodeB.advertise(nodeA.peerId)
        advanceUntilIdle()

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

        nodeA.advertise(nodeB.peerId)
        nodeB.advertise(nodeA.peerId)
        advanceUntilIdle()
        assertEquals(1, engineA.stats().peersSynced)
        assertEquals(1, nodeA.connectCount.get())

        // Re-seeing the same peer immediately, still within cooldown, must
        // not trigger a second connect().
        nodeA.advertise(nodeB.peerId)
        advanceUntilIdle()
        assertEquals(1, nodeA.connectCount.get())

        // Advancing past the cooldown window allows a new attempt.
        fakeNow += 60_000
        nodeA.advertise(nodeB.peerId)
        advanceUntilIdle()
        assertEquals(2, nodeA.connectCount.get())
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
    private class FakeTransport(val peerId: String, private val medium: FakeMedium) : PeerTransport {
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
            medium.deliver(to = connection.peerId, from = this.peerId, payload)
            return TransferResult.Success(bytesTransferred = payload.size.toLong(), durationMillis = 0)
        }

        override suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult =
            send(connection, payload)

        override suspend fun close(connection: Connection) = Unit

        fun receive(from: String, payload: ByteArray) {
            received.tryEmit(from to payload)
        }

        fun advertise(peerId: String) {
            discoverFlow.tryEmit(PeerAdvertisement(peerId = peerId, rssi = null, discoveredAtMillis = 0))
        }
    }
}
