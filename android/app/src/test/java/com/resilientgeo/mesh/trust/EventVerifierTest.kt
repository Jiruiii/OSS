package com.resilientgeo.mesh.trust

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * These fixtures are real Ed25519 signatures produced by
 * `pipeline/lib/contract.mjs`'s `signEvent()` (see
 * `scratch-generate-android-fixture.mjs` at the repo root) — not
 * hand-authored tokens. A pass here means the Android trust adapter
 * (Canonical + Ed25519Verifier + EventShapeValidator) round-trips with the
 * server-side pipeline module A owns, byte for byte.
 */
class EventVerifierTest {

    private val trustStore = TestFixtures.trustedKeyStore()
    private val now = Instant.parse("2026-09-04T12:00:00Z")

    @Test
    fun `accepts a genuinely signed current event`() {
        val event = TestFixtures.event("official.cwa", "flood:neihu-0901-001", 1)
        val result = EventVerifier.verify(event, trustStore, now)
        assertTrue(result is VerificationResult.Valid)
        assertFalse((result as VerificationResult.Valid).expired)
    }

    @Test
    fun `flags an expired but otherwise valid event`() {
        val event = TestFixtures.event("official.fire", "shelter:wende-01", 1)
        val result = EventVerifier.verify(event, trustStore, now)
        assertTrue(result is VerificationResult.Valid)
        assertTrue((result as VerificationResult.Valid).expired)
    }

    @Test
    fun `rejects a tampered payload at the integrity stage`() {
        val event = org.json.JSONObject(TestFixtures.event("official.tdx", "road:dahu-01", 1).toString())
        event.getJSONObject("attributes").put("status", "OPEN") // was CLOSED when signed
        val result = EventVerifier.verify(event, trustStore, now)
        assertTrue(result is VerificationResult.Invalid)
        assertEquals(VerificationResult.Stage.INTEGRITY, (result as VerificationResult.Invalid).stage)
    }

    @Test
    fun `rejects a corrupted signature at the signature stage`() {
        val event = org.json.JSONObject(TestFixtures.event("official.cwa", "flood:neihu-0901-001", 1).toString())
        val signature = event.getString("signature")
        val flipped = if (signature.first() == 'A') "B" + signature.drop(1) else "A" + signature.drop(1)
        event.put("signature", flipped)
        val result = EventVerifier.verify(event, trustStore, now)
        assertTrue(result is VerificationResult.Invalid)
        assertEquals(VerificationResult.Stage.SIGNATURE, (result as VerificationResult.Invalid).stage)
    }

    @Test
    fun `rejects an event signed by an untrusted key`() {
        val event = org.json.JSONObject(TestFixtures.event("official.cwa", "flood:neihu-0901-001", 1).toString())
        event.put("signing_key_id", "some-other-key")
        val result = EventVerifier.verify(event, trustStore, now)
        assertTrue(result is VerificationResult.Invalid)
        assertEquals(VerificationResult.Stage.TRUST, (result as VerificationResult.Invalid).stage)
    }
}
