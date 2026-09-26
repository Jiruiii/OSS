package com.resilientgeo.mesh.trust

import com.resilientgeo.mesh.ingest.ApplyState
import com.resilientgeo.mesh.ingest.EventIngestor
import com.resilientgeo.mesh.ingest.InMemoryEventStore
import com.resilientgeo.mesh.ingest.IngestResult
import com.resilientgeo.mesh.report.CrowdReportFactory
import com.resilientgeo.mesh.report.CrowdReportInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import java.time.Instant

/**
 * Same five cases as pipeline/test/crowd-signature.test.mjs over the same
 * fixture bytes: the Kotlin and JS verifiers must agree stage for stage.
 */
class CrowdSignatureTest {

    @Test
    fun `every fixture event case matches the JS verdict and stage`() {
        val trustStore = CrowdFixtures.trustStore()
        for (case in CrowdFixtures.eventCases()) {
            val expect = case.getJSONObject("expect")
            val result = EventVerifier.verify(case.getJSONObject("event"), trustStore, CrowdFixtures.now)
            assertEquals(case.getString("name"), expect.getBoolean("valid"), result.isValid)
            if (result is VerificationResult.Invalid) {
                assertEquals(case.getString("name"), expect.getString("stage").uppercase(), result.stage.name)
            }
        }
    }

    @Test
    fun `a valid device report ingests as UNVERIFIED with no bundled trust entry`() {
        val store = InMemoryEventStore()
        val result = EventIngestor.ingest(
            store,
            CrowdFixtures.eventCase("valid_report").getJSONObject("event"),
            TrustedKeyStore(emptyMap()),
            CrowdFixtures.now,
        )
        assertEquals(ApplyState.UNVERIFIED, (result as IngestResult.Inserted).state)
    }

    @Test
    fun `a device key stays untrusted for official namespaces even if it is in the trust store`() {
        // Reverse test pinning the Global Constraint: crowd trust never loosens official.*.
        val impostor = CrowdFixtures.eventCase("device_key_official_namespace").getJSONObject("event")
        val trustStore = TrustedKeyStore(
            mapOf(impostor.getString("signing_key_id") to impostor.getString("signer_public_key")),
        )
        val result = EventVerifier.verify(impostor, trustStore, CrowdFixtures.now)
        assertEquals(VerificationResult.Stage.TRUST, (result as VerificationResult.Invalid).stage)
    }

    @Test
    fun `fixture attestations verify under the fixture official key`() {
        for (attestation in CrowdFixtures.attestations()) {
            assertTrue(EventVerifier.verify(attestation, CrowdFixtures.trustStore(), CrowdFixtures.now).isValid)
        }
    }

    @Test
    fun `device key id is the SPKI fingerprint used by the JS generator`() {
        val key = CrowdFixtures.deviceKey("crowd-fixture-device-a")
        assertEquals(CrowdFixtures.root.getString("device_key_id"), key.keyId())
        assertEquals(key.keyId(), DeviceKeys.keyIdFromSpkiBase64(key.publicKeySpkiBase64()))
        assertTrue(key.keyId().matches(Regex("^device:[0-9a-f]{32}$")))
    }

    @Test
    fun `an event signed by DeviceSigningKey round-trips through EventVerifier`() {
        val key = DeviceSigningKey.loadOrCreate(InMemoryStorage(), SecureRandom())
        val event = CrowdReportFactory.create(
            CrowdReportInput("FIRE_SMOKE", "濃煙", 121.58, 25.08, "CURRENT_LOCATION"),
            key,
            Instant.parse("2026-09-24T00:00:00Z"),
        )
        val result = EventVerifier.verify(event, TrustedKeyStore(emptyMap()), Instant.parse("2026-09-24T01:00:00Z"))
        assertTrue(result.toString(), result.isValid)
    }

    @Test
    fun `the device key persists across loads and never prints its private half`() {
        val storage = InMemoryStorage()
        val first = DeviceSigningKey.loadOrCreate(storage, SecureRandom())
        val second = DeviceSigningKey.loadOrCreate(storage, SecureRandom())
        assertEquals(first.keyId(), second.keyId())
        assertNotEquals(first.keyId(), DeviceSigningKey.loadOrCreate(InMemoryStorage(), SecureRandom()).keyId())
        val seedHex = storage.seed!!.joinToString("") { "%02x".format(it) }
        assertFalse(first.toString().contains(seedHex))
        assertEquals("DeviceSigningKey(${first.keyId()})", first.toString())
    }

    private class InMemoryStorage : DeviceSigningKey.Storage {
        var seed: ByteArray? = null
        override fun read(): ByteArray? = seed
        override fun write(seed: ByteArray) {
            this.seed = seed.copyOf()
        }
    }
}
