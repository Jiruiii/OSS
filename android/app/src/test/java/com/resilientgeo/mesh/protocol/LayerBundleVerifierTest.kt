package com.resilientgeo.mesh.protocol

import com.resilientgeo.mesh.trust.TrustedKeyStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LayerBundleVerifierTest {

    @Test
    fun `rejects a malformed layer manifest before accepting chunks`() {
        val result = LayerBundleVerifier.verify(
            JSONObject("""{"schema_version":"layer-manifest-v0"}"""),
            emptyList(),
            TrustedKeyStore(emptyMap()),
        )

        assertEquals(false, result.valid)
        assertEquals(LayerVerificationResult.Stage.SCHEMA, result.stage)
    }
}
