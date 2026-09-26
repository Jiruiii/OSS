package com.resilientgeo.mesh.protocol

import com.resilientgeo.mesh.trust.TestFixtures
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The nationwide shelter layer shipped in assets/static/taiwan/shelter must
 * verify against the trust store the app ships, or MeshRepository fails
 * closed and the map shows no shelters at all.
 */
class PackagedShelterLayerTest {

    @Test
    fun `packaged shelter layer verifies against the bundled trust store`() {
        val root = File("src/main/assets/static/taiwan/shelter")
        val manifest = JSONObject(File(root, "manifest.json").readText())
        val chunks = File(root, "chunks").listFiles { file -> file.extension == "json" }!!
            .sortedBy { it.name }
            .map { JSONObject(it.readText()) }

        val result = LayerBundleVerifier.verify(manifest, chunks, TestFixtures.trustedKeyStore())

        assertTrue(result.errors.toString(), result.valid)
        assertEquals(manifest.getInt("total_feature_count"), result.features.size)
        assertTrue(result.features.all { it.getString("layer_id") == "shelter" })
        val names = result.features.map { it.getJSONObject("properties").optString("name") }
        assertTrue(names.contains("西湖國小"))
        assertTrue(names.contains("潭美國小"))
    }
}
