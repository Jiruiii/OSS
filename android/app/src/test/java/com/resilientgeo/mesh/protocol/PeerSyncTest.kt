package com.resilientgeo.mesh.protocol

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Ports every case in `pipeline/test/peer-sync.test.mjs` to prove
 * `PeerSync` behaves identically to the Node module it was ported from,
 * against the exact same fixtures (`fixtures/protocol-exchange-v0.json`,
 * `peer-a/b-summary-v0.json`). No device or emulator needed — this is the
 * one deliverable 甲 is waiting on before wiring real transfers into
 * `BleGattTransport`.
 */
class PeerSyncTest {

    private val exchange = PeerSyncTestFixtures.exchange()
    private val peerA = PeerSyncTestFixtures.peerSummary("peer-a-summary-v0.json")
    private val peerB = PeerSyncTestFixtures.peerSummary("peer-b-summary-v0.json")

    private val diffMessage = findMessage("DIFF")
    private val requestMessage = findMessage("REQUEST")
    private val datasetId = diffMessage.getString("dataset_id")
    private val namespace = diffMessage.getString("namespace")

    private fun findMessage(type: String): JSONObject {
        val messages = exchange.getJSONArray("messages")
        for (i in 0 until messages.length()) {
            val message = messages.getJSONObject(i)
            if (message.getString("type") == type) return message
        }
        error("fixture has no $type message")
    }

    private fun chunkIdsOf(array: org.json.JSONArray): List<String> =
        (0 until array.length()).map { array.getJSONObject(it).getString("chunk_id") }

    @Test
    fun `computeDiff finds the chunk node-a is missing from node-b`() {
        val diff = PeerSync.computeDiff(peerA, peerB, datasetId, namespace)

        assertEquals(diffMessage.getString("manifest_id"), diff.manifestId)
        assertEquals(chunkIdsOf(diffMessage.getJSONArray("missing_chunks")), diff.missingChunks.map { it.chunkId })
        assertEquals(0, diffMessage.getJSONArray("stale_chunks").length())
        assertEquals(emptyList<String>(), diff.staleChunks.map { it.chunkId })

        val expectedBeforeSync = exchange.getJSONObject("expected").getJSONArray("a_missing_chunks_before_sync")
        assertEquals(
            (0 until expectedBeforeSync.length()).map { expectedBeforeSync.getString(it) },
            diff.missingChunks.map { it.chunkId },
        )
    }

    @Test
    fun `buildRequest matches the fixture REQUEST message`() {
        val diff = PeerSync.computeDiff(peerA, peerB, datasetId, namespace)
        val request = PeerSync.buildRequest(diff, resume = requestMessage.getBoolean("resume"))

        val expectedChunkIds = chunkIdsOf(requestMessage.getJSONArray("chunks"))
        assertEquals(expectedChunkIds, request.chunks.map { it.chunkId })
        assertEquals(requestMessage.getLong("max_total_bytes"), request.maxTotalBytes)
        assertEquals(requestMessage.getBoolean("resume"), request.resume)
    }

    @Test
    fun `after applying the request, node-a is missing nothing`() {
        val diff = PeerSync.computeDiff(peerA, peerB, datasetId, namespace)

        val merged = peerA.datasets[0].chunks.associateBy { it.chunkId }.toMutableMap()
        for (missing in diff.missingChunks) {
            merged[missing.chunkId] = ChunkSummary(missing.chunkId, missing.chunkHash, missing.sizeBytes, missing.priority)
        }
        val peerAAfterSync = peerA.copy(
            datasets = listOf(peerA.datasets[0].copy(chunks = merged.values.toList())),
        )

        val diffAfterSync = PeerSync.computeDiff(peerAAfterSync, peerB, datasetId, namespace)

        val expectedAfterSync = exchange.getJSONObject("expected").getJSONArray("a_missing_chunks_after_sync")
        assertEquals(
            (0 until expectedAfterSync.length()).map { expectedAfterSync.getString(it) },
            diffAfterSync.missingChunks.map { it.chunkId },
        )
    }

    @Test
    fun `computeDiff rejects two manifests that both claim the same dataset_version`() {
        val peerBWrongManifest = peerB.copy(
            datasets = listOf(peerB.datasets[0].copy(manifestId = "demo:official:999")),
        )

        val thrown = assertThrows(PeerSyncException::class.java) {
            PeerSync.computeDiff(peerA, peerBWrongManifest, datasetId, namespace)
        }
        assert(thrown.message?.contains("manifest mismatch") == true) {
            "expected 'manifest mismatch' in exception message, got: ${thrown.message}"
        }
    }

    @Test
    fun `computeDiff treats a peer carrying a newer manifest_id as a DTN supersession, not an error`() {
        // A walks into a shelter carrying v137; everyone there (peerB) is
        // still on v136. This must produce a usable diff, not throw.
        val newerChunk = ChunkSummary(
            chunkId = "resilientgeo-demo:chunk:137:dahu:road:000",
            chunkHash = "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            sizeBytes = 512,
            priority = Priority.CRITICAL,
        )
        val peerNewerManifest = peerA.copy(
            datasets = listOf(
                peerA.datasets[0].copy(
                    manifestId = "resilientgeo-demo:manifest:137",
                    datasetVersion = 137,
                    chunks = listOf(newerChunk),
                ),
            ),
        )

        val diff = PeerSync.computeDiff(peerNewerManifest, peerB, datasetId, namespace)

        // Remote (peerB, v136) has nothing local doesn't already have --
        // local's own newer manifest_id stays current.
        assertEquals("resilientgeo-demo:manifest:137", diff.manifestId)
        assertNull(diff.supersededManifestId)
        assertEquals(emptyList<ChunkRef>(), diff.missingChunks)
        assertEquals(emptyList<ChunkRef>(), diff.staleChunks)
    }

    @Test
    fun `computeDiff requests every chunk from a peer carrying a newer manifest_id`() {
        val newerChunk = ChunkSummary(
            chunkId = "resilientgeo-demo:chunk:137:dahu:road:000",
            chunkHash = "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            sizeBytes = 512,
            priority = Priority.CRITICAL,
        )
        val peerBNewerManifest = peerB.copy(
            datasets = listOf(
                peerB.datasets[0].copy(
                    manifestId = "resilientgeo-demo:manifest:137",
                    datasetVersion = 137,
                    chunks = listOf(newerChunk),
                ),
            ),
        )

        val diff = PeerSync.computeDiff(peerA, peerBNewerManifest, datasetId, namespace)

        assertEquals("resilientgeo-demo:manifest:137", diff.manifestId)
        assertEquals("resilientgeo-demo:manifest:136", diff.supersededManifestId)
        assertEquals(emptyList<ChunkRef>(), diff.staleChunks)
        assertEquals(listOf("resilientgeo-demo:chunk:137:dahu:road:000"), diff.missingChunks.map { it.chunkId })

        val request = PeerSync.buildRequest(diff)
        assertEquals("resilientgeo-demo:manifest:136", request.supersededManifestId)
    }
}
