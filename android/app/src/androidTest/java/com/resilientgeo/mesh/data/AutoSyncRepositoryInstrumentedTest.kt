package com.resilientgeo.mesh.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Covers the two additions `AutoPeerSyncEngine` needs beyond the two-device
 * Peer Sync milestone: a HELLO that enumerates every dataset this node
 * holds (not one hardcoded pair), and a cache that can actually hand a
 * chunk's bytes back out to serve a REQUEST — the milestone demo never
 * needed this because Node B always served straight from `assets/`, never
 * from what it had itself received.
 *
 * Runs against a real device/emulator, same as `PeerSummaryConformanceInstrumentedTest`:
 * both `allLocalPeerSummaries` and the chunk cache are built on Room and the
 * app's real files directory.
 */
@RunWith(AndroidJUnit4::class)
class AutoSyncRepositoryInstrumentedTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val repository = MeshRepository(context)

    private fun realSignedChunkFixture(): JSONObject =
        JSONObject(
            context.assets.open("fixtures/peer-sync/chunk-136-dahu-shelter-000.json")
                .bufferedReader().use { it.readText() },
        )

    @Test
    fun allLocalPeerSummariesDeclaresTheKnownDatasetEvenWithNothingHeldForIt() {
        // A brand-new node has never ingested anything for some other
        // dataset it might still be asked about — this only pins the
        // well-known demo dataset/namespace, which every node declares
        // regardless of inventory (see MeshRepository.KNOWN_DATASETS).
        val summary = runBlocking { repository.allLocalPeerSummaries("node-under-test") }
        val datasets = summary.getJSONArray("datasets")
        val demo = (0 until datasets.length())
            .map { datasets.getJSONObject(it) }
            .first { it.getString("dataset_id") == "resilientgeo-demo" && it.getString("namespace") == "official" }
        assertTrue(demo.has("manifest_id"))
        assertTrue(demo.has("chunks"))
    }

    @Test
    fun ingestedChunkBecomesServableAndAppearsInTheFullSummary() {
        val chunk = realSignedChunkFixture()
        val chunkId = chunk.getString("chunk_id")

        val result = runBlocking { repository.ingestChunk(chunk) }
        assertTrue("expected the real signed fixture to verify: $result", result is ChunkIngestResult.Applied)

        // AutoPeerSyncEngine.serveRequest reads exactly this, to answer a
        // peer's REQUEST for a chunk this node has already verified.
        val cached = runBlocking { repository.cachedChunkJson("resilientgeo-demo", "official", chunkId) }
        assertNotNull("expected $chunkId to be servable after ingest", cached)
        assertEquals(chunk.getString("chunk_hash"), cached!!.getString("chunk_hash"))

        val summary = runBlocking { repository.allLocalPeerSummaries("node-under-test") }
        val datasets = summary.getJSONArray("datasets")
        val demo = (0 until datasets.length())
            .map { datasets.getJSONObject(it) }
            .first { it.getString("dataset_id") == "resilientgeo-demo" && it.getString("namespace") == "official" }
        val chunkIds = (0 until demo.getJSONArray("chunks").length())
            .map { demo.getJSONArray("chunks").getJSONObject(it).getString("chunk_id") }
        assertTrue("expected $chunkId in $chunkIds", chunkIds.contains(chunkId))
    }

    @Test
    fun aChunkNeverIngestedIsNotServable() {
        val cached = runBlocking {
            repository.cachedChunkJson("resilientgeo-demo", "official", "resilientgeo-demo:chunk:does-not-exist")
        }
        assertNull(cached)
    }
}
