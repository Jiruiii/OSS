package com.resilientgeo.mesh.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The HELLO this node puts on the air must match the schema the project
 * publishes as its module interface.
 *
 * It did not. `schemas/peer-summary-v0.schema.json` requires six top-level
 * fields; the hand-written summaries in the peer-sync screen carried three,
 * and nothing caught it because `PeerSummary.fromJson` only reads two of
 * them. A schema that the only real over-the-air message does not satisfy is
 * worse than no schema, because it is quoted in the docs as if it were the
 * contract.
 *
 * These assertions run against a real device rather than a JVM fake because
 * the summary is assembled from Room.
 */
@RunWith(AndroidJUnit4::class)
class PeerSummaryConformanceInstrumentedTest {

    private val repository = MeshRepository(ApplicationProvider.getApplicationContext())

    private fun summary() = runBlocking {
        repository.localPeerSummary(
            nodeId = "node-a",
            datasetId = "resilientgeo-demo",
            namespace = "official",
            fallbackManifestId = "resilientgeo-demo:manifest:136",
            fallbackDatasetVersion = 136,
        )
    }

    @Test
    fun carriesEveryRequiredTopLevelField() {
        val json = summary()
        // Exactly the `required` list in schemas/peer-summary-v0.schema.json.
        for (field in listOf(
            "schema_version", "protocol_version", "node_id",
            "generated_at", "capabilities", "datasets",
        )) {
            assertTrue("missing required field: $field", json.has(field))
        }
        assertEquals("peer-summary-v0", json.getString("schema_version"))
        assertEquals("0", json.getString("protocol_version"))
        assertEquals("node-a", json.getString("node_id"))
    }

    @Test
    fun generatedAtIsAnRfc3339Instant() {
        // The schema declares format: date-time; a Z-suffixed, second-precision
        // instant is what every other timestamp in this project uses.
        val generatedAt = summary().getString("generated_at")
        assertTrue(
            "not an RFC 3339 UTC instant: $generatedAt",
            Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$""").matches(generatedAt),
        )
    }

    @Test
    fun advertisesOnlyTheTransportThisAppActuallyImplements() {
        val capabilities = summary().getJSONObject("capabilities")
        for (field in listOf(
            "discovery_transports", "transfer_transports",
            "max_peer_count", "supports_resume", "max_chunk_bytes",
        )) {
            assertTrue("missing required capability: $field", capabilities.has(field))
        }
        // ADR-001 rejected Nearby Connections and Wi-Fi Direct and their
        // implementations have been deleted. Advertising them would be a
        // claim a peer could act on and be wrong about.
        assertEquals(1, capabilities.getJSONArray("transfer_transports").length())
        assertEquals("BLE_GATT", capabilities.getJSONArray("transfer_transports").getString(0))
        assertEquals("BLE", capabilities.getJSONArray("discovery_transports").getString(0))
        assertTrue(capabilities.getBoolean("supports_resume"))
        // Schema caps max_peer_count at 5.
        assertTrue(capabilities.getInt("max_peer_count") in 1..5)
    }

    @Test
    fun datasetSectionIsWellFormedEvenWithAnEmptyInventory() {
        val dataset = summary().getJSONArray("datasets").getJSONObject(0)
        assertEquals("resilientgeo-demo", dataset.getString("dataset_id"))
        assertEquals("official", dataset.getString("namespace"))
        assertTrue(dataset.has("manifest_id"))
        assertTrue(dataset.has("dataset_version"))
        // "I hold nothing" is a legitimate HELLO, not an error — it is the
        // state every device starts the demo in.
        assertTrue(dataset.has("chunks"))
    }
}
