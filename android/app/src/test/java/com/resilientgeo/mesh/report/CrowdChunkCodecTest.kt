package com.resilientgeo.mesh.report

import com.resilientgeo.mesh.protocol.ChunkSummary
import com.resilientgeo.mesh.protocol.ChunkVerifier
import com.resilientgeo.mesh.protocol.DatasetSummary
import com.resilientgeo.mesh.protocol.PeerSummary
import com.resilientgeo.mesh.protocol.PeerSync
import com.resilientgeo.mesh.protocol.Priority
import com.resilientgeo.mesh.trust.Canonical
import com.resilientgeo.mesh.trust.CrowdFixtures
import com.resilientgeo.mesh.trust.TrustedKeyStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CrowdChunkCodecTest {
    private val deviceA = CrowdFixtures.deviceKey("crowd-fixture-device-a")
    private val noTrust = TrustedKeyStore(emptyMap())
    private val now = CrowdFixtures.now

    private fun report() = CrowdFixtures.copy(CrowdFixtures.eventCase("valid_report").getJSONObject("event"))

    @Test
    fun `rebuilds the JS fixture chunk byte for byte`() {
        val chunk = CrowdChunkCodec.build(report(), deviceA)
        val expected = CrowdFixtures.chunkCase("valid_chunk").getJSONObject("chunk")
        assertEquals(Canonical.canonicalize(expected), Canonical.canonicalize(chunk))
    }

    @Test
    fun `every fixture chunk case matches the JS verdict and error`() {
        for (case in CrowdFixtures.chunkCases()) {
            val expect = case.getJSONObject("expect")
            val result = ChunkVerifier.verify(case.getJSONObject("chunk"), noTrust, now)
            if (expect.getBoolean("valid")) {
                assertTrue(case.getString("name"), result is ChunkVerifier.Result.Valid)
            } else {
                assertEquals(case.getString("name"), expect.getString("error"), (result as ChunkVerifier.Result.Invalid).reason)
            }
        }
    }

    @Test
    fun `round trip through serialized bytes still verifies`() {
        val chunk = CrowdChunkCodec.build(report(), deviceA)
        val received = org.json.JSONObject(chunk.toString())
        val result = ChunkVerifier.verify(received, noTrust, now)
        assertEquals(1, (result as ChunkVerifier.Result.Valid).events.size)
    }

    @Test
    fun `relay tampering, rebinding and oversized chunks are rejected`() {
        val tampered = CrowdChunkCodec.build(report(), deviceA)
        tampered.getJSONArray("events").getJSONObject(0).getJSONObject("attributes").put("description", "改寫")
        assertEquals("chunk_hash_mismatch", reason(tampered))

        val rebound = CrowdChunkCodec.build(report(), deviceA).put("chunk_id", "crowd:report:other")
        assertEquals("crowd_chunk_binding_invalid", reason(rebound))

        val moved = CrowdChunkCodec.build(report(), deviceA)
        moved.getJSONArray("bbox").put(0, 121.0)
        assertEquals("chunk_bbox_mismatch", reason(moved))

        val padded = CrowdChunkCodec.build(report(), deviceA)
        padded.getJSONArray("events").getJSONObject(0).getJSONObject("attributes").put("description", "測".repeat(1500))
        assertEquals("crowd_chunk_too_large", reason(padded))
    }

    @Test
    fun `an expired report is still a valid chunk so the receiver can store it as EXPIRED`() {
        val result = ChunkVerifier.verify(CrowdChunkCodec.build(report(), deviceA), noTrust, Instant.parse("2027-01-01T00:00:00Z"))
        assertTrue(result is ChunkVerifier.Result.Valid)
    }

    @Test
    fun `computeDiff finds the crowd reports a neighbour holds and this node lacks`() {
        fun summary(node: String, vararg chunkIds: String) = PeerSummary(
            node,
            listOf(
                DatasetSummary(
                    datasetId = CrowdChunkCodec.DATASET_ID,
                    namespace = CrowdChunkCodec.NAMESPACE,
                    manifestId = CrowdChunkCodec.MANIFEST_ID,
                    datasetVersion = CrowdChunkCodec.DATASET_VERSION,
                    chunks = chunkIds.map { ChunkSummary(it, "sha256:${it.hashCode()}", 1500, Priority.NORMAL) },
                ),
            ),
        )
        val local = summary("node-b", "crowd:report:a", "crowd:report:b")
        val remote = summary("node-c", "crowd:report:b", "crowd:report:c", "crowd:report:d")
        val diff = PeerSync.computeDiff(local, remote, CrowdChunkCodec.DATASET_ID, CrowdChunkCodec.NAMESPACE)
        assertEquals(listOf("crowd:report:c", "crowd:report:d"), diff.missingChunks.map { it.chunkId })
        assertTrue(diff.staleChunks.isEmpty())
        assertEquals(null, diff.supersededManifestId)
    }

    private fun reason(chunk: org.json.JSONObject): String =
        (ChunkVerifier.verify(chunk, noTrust, now) as ChunkVerifier.Result.Invalid).reason
}
