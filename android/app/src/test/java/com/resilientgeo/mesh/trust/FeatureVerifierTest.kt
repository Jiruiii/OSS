package com.resilientgeo.mesh.trust

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class FeatureVerifierTest {

    @Test
    fun `rejects an unsigned feature before trust or storage`() {
        val result = FeatureVerifier.verify(
            JSONObject("""{"schema_version":"feature-v0"}"""),
            TrustedKeyStore(emptyMap()),
        )

        assertEquals(FeatureVerificationResult.Stage.SCHEMA, result.stage)
        assertEquals(false, result.valid)
    }
}
