package com.resilientgeo.mesh.protocol

import com.resilientgeo.mesh.trust.TrustedKeyStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LayerChunkVerifierTest {

    @Test
    fun `rejects a malformed static layer chunk before exposing features`() {
        val result = LayerChunkVerifier.verify(
            JSONObject("""{"schema_version":"layer-chunk-v0","features":[]}"""),
            TrustedKeyStore(emptyMap()),
        )

        assertEquals(false, result.valid)
        assertEquals(LayerVerificationResult.Stage.SCHEMA, result.stage)
    }
}
