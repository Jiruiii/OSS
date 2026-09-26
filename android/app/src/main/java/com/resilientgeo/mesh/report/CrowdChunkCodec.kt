package com.resilientgeo.mesh.report

import com.resilientgeo.mesh.protocol.ChunkVerifier
import com.resilientgeo.mesh.trust.Canonical
import com.resilientgeo.mesh.trust.DeviceKeys
import com.resilientgeo.mesh.trust.DeviceSigningKey
import com.resilientgeo.mesh.trust.Ed25519Verifier
import com.resilientgeo.mesh.trust.EventShapeValidator
import com.resilientgeo.mesh.trust.EventVerifier
import com.resilientgeo.mesh.trust.TrustedKeyStore
import com.resilientgeo.mesh.trust.VerificationResult
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.time.Instant

/**
 * One crowd report per `chunk-v0`, signed by the reporting device
 * (docs/peer-sync-v0.md「群眾回報分片」). Kotlin port of `buildCrowdChunk()` /
 * `verifyCrowdChunk()` in `pipeline/lib/crowd-report.mjs`; error strings and
 * check order match so both sides reject the shared fixture the same way.
 *
 * Relays forward the chunk untouched and never re-sign it, so every hop can
 * still see which device key produced the report.
 */
object CrowdChunkCodec {
    const val DATASET_ID = "crowd-reports"
    const val NAMESPACE = CrowdReportFactory.NAMESPACE
    const val MANIFEST_ID = "crowd:none"
    const val DATASET_VERSION = 1

    /**
     * Upper bound on the canonical chunk payload. The largest legitimate report
     * (160 CJK characters plus an 80+80 character location hint) is ~2.4 KB.
     */
    const val MAX_PAYLOAD_BYTES = 4096

    fun chunkIdFor(eventId: String): String = "crowd:$eventId"

    fun eventIdFor(chunkId: String): String? = chunkId.takeIf { it.startsWith("crowd:") }?.removePrefix("crowd:")

    fun build(event: JSONObject, key: DeviceSigningKey): JSONObject {
        require(event.getString("signing_key_id") == key.keyId()) { "only the reporting device wraps its own report" }
        val coordinates = event.getJSONObject("geometry").getJSONArray("coordinates")
        val lon = CrowdReportFactory.roundCoordinate(coordinates.getDouble(0))
        val lat = CrowdReportFactory.roundCoordinate(coordinates.getDouble(1))
        val chunk = JSONObject()
            .put("schema_version", "chunk-v0")
            .put("chunk_id", chunkIdFor(event.getString("event_id")))
            .put("manifest_id", MANIFEST_ID)
            .put("manifest_hash", event.getString("payload_hash"))
            .put("dataset_id", DATASET_ID)
            .put("namespace", event.getString("namespace"))
            .put("dataset_version", DATASET_VERSION)
            .put("sequence", 0)
            .put("priority", priorityForSeverity(event.getString("severity")))
            .put("area_id", "crowd")
            .put("theme", "report")
            .put("bbox", JSONArray().put(lon).put(lat).put(lon).put(lat))
            .put("created_at", event.getString("issued_at"))
            .put("content_type", "application/json")
            .put("content_encoding", "identity")
            .put("event_count", 1)
            .put("events", JSONArray().put(event))
            .put("signature_algorithm", "Ed25519")
            .put("signing_key_id", event.getString("signing_key_id"))
        val payload = payloadBytes(chunk)
        chunk.put("byte_length", payload.size)
        chunk.put("chunk_hash", Canonical.sha256Bytes(payload))
        chunk.put("signature", key.signCanonical(Canonical.canonicalize(ChunkVerifier.chunkSignatureInput(chunk))))
        return chunk
    }

    fun verify(chunk: JSONObject, trustStore: TrustedKeyStore, now: Instant): ChunkVerifier.Result {
        return try {
            verifyOrThrow(chunk, trustStore, now)
        } catch (_: org.json.JSONException) {
            ChunkVerifier.Result.Invalid("crowd_chunk_shape_invalid")
        }
    }

    private fun verifyOrThrow(chunk: JSONObject, trustStore: TrustedKeyStore, now: Instant): ChunkVerifier.Result {
        if (!shapeValid(chunk)) return invalid("crowd_chunk_shape_invalid")
        if (chunk.optString("dataset_id") != DATASET_ID || !DeviceKeys.isCrowdNamespace(chunk.optString("namespace"))) {
            return invalid("not_a_crowd_chunk")
        }
        val events = chunk.getJSONArray("events")
        if (events.length() != 1 || chunk.optInt("event_count", -1) != 1) {
            return invalid("crowd_chunk_must_hold_one_event")
        }
        val event = events.getJSONObject(0)
        if (EventShapeValidator.validate(event).isNotEmpty()) return invalid("crowd_event_shape_invalid")
        if (chunk.getString("chunk_id") != chunkIdFor(event.getString("event_id")) ||
            chunk.getString("manifest_id") != MANIFEST_ID ||
            chunk.getString("manifest_hash") != event.getString("payload_hash") ||
            chunk.getInt("dataset_version") != DATASET_VERSION ||
            chunk.getString("namespace") != event.getString("namespace")
        ) {
            return invalid("crowd_chunk_binding_invalid")
        }
        val payload = payloadBytes(chunk)
        if (payload.size > MAX_PAYLOAD_BYTES) return invalid("crowd_chunk_too_large")
        val signingKeyId = chunk.getString("signing_key_id")
        if (!DeviceKeys.isDeviceKeyId(signingKeyId) || signingKeyId != event.getString("signing_key_id")) {
            return invalid("crowd_chunk_signer_mismatch")
        }
        val publicKey = when (val device = DeviceKeys.resolve(event)) {
            is DeviceKeys.Resolution.Resolved -> device.publicKey
            is DeviceKeys.Resolution.Rejected -> return invalid(device.error)
        }
        if (!bboxMatches(chunk.getJSONArray("bbox"), event)) return invalid("chunk_bbox_mismatch")
        if (Canonical.sha256Bytes(payload) != chunk.getString("chunk_hash")) return invalid("chunk_hash_mismatch")
        if (payload.size != chunk.getInt("byte_length")) return invalid("chunk_byte_length_mismatch")
        val signatureInput = Canonical.canonicalize(ChunkVerifier.chunkSignatureInput(chunk))
        if (!Ed25519Verifier.verify(signatureInput, chunk.getString("signature"), publicKey)) {
            return invalid("chunk_signature_invalid")
        }
        if (EventVerifier.verify(event, trustStore, now) !is VerificationResult.Valid) {
            return invalid("chunk_contains_invalid_event")
        }
        return ChunkVerifier.Result.Valid(listOf(event))
    }

    private fun invalid(reason: String) = ChunkVerifier.Result.Invalid(reason)

    private fun payloadBytes(chunk: JSONObject): ByteArray =
        Canonical.canonicalize(ChunkVerifier.chunkContent(chunk)).toByteArray(StandardCharsets.UTF_8)

    private fun priorityForSeverity(severity: String) =
        if (severity == "CRITICAL" || severity == "HIGH") "HIGH" else "NORMAL"

    private val REQUIRED_STRINGS = listOf(
        "schema_version", "chunk_id", "manifest_id", "manifest_hash", "dataset_id", "namespace",
        "priority", "area_id", "theme", "created_at", "content_type", "content_encoding",
        "chunk_hash", "signature", "signature_algorithm", "signing_key_id",
    )

    /** The subset of validateChunkShape() in contract.mjs that a crowd chunk can fail. */
    private fun shapeValid(chunk: JSONObject): Boolean =
        REQUIRED_STRINGS.all { chunk.opt(it) is String } &&
            chunk.optString("schema_version") == "chunk-v0" &&
            chunk.optString("signature_algorithm") == "Ed25519" &&
            chunk.optString("content_type") == "application/json" &&
            chunk.opt("events") is JSONArray &&
            (chunk.opt("bbox") as? JSONArray)?.length() == 4 &&
            chunk.opt("byte_length") is Number &&
            chunk.opt("event_count") is Number

    /** Recomputes the Point bbox the way bboxOfEvents() does (6-decimal rounding). */
    private fun bboxMatches(bbox: JSONArray, event: JSONObject): Boolean {
        val geometry = event.optJSONObject("geometry") ?: return false
        if (geometry.optString("type") != "Point") return false
        val coordinates = geometry.getJSONArray("coordinates")
        val lon = CrowdReportFactory.roundCoordinate(coordinates.getDouble(0))
        val lat = CrowdReportFactory.roundCoordinate(coordinates.getDouble(1))
        val expected = doubleArrayOf(lon, lat, lon, lat)
        return (0 until 4).all { bbox.getDouble(it) == expected[it] }
    }
}
