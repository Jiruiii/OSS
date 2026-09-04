package com.resilientgeo.mesh.trust

import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.regex.Pattern

/**
 * Kotlin port of `validateEventShape()` in `pipeline/lib/contract.mjs`.
 * Kept in lockstep with that function; see `event-v0.schema.json` for the
 * full JSON Schema this approximates.
 */
object EventShapeValidator {

    private val REQUIRED_FIELDS = listOf(
        "schema_version", "namespace", "event_id", "event_type", "geometry",
        "severity", "source", "source_version", "event_version", "issued_at",
        "expires_at", "attributes", "payload_hash", "signature",
        "signature_algorithm", "signing_key_id", "provenance",
    )
    private val SEVERITIES = setOf("LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN")
    private val SHA256_RE = Pattern.compile("^sha256:[0-9a-fA-F]{64}$")
    private val BASE64_RE = Pattern.compile("^[A-Za-z0-9+/]+={0,2}$")

    fun validate(event: JSONObject): List<String> {
        val errors = mutableListOf<String>()
        for (field in REQUIRED_FIELDS) {
            if (!event.has(field)) errors.add("missing required field: $field")
        }
        if (event.optString("schema_version") != "event-v0") errors.add("schema_version must be event-v0")
        for (field in listOf("namespace", "event_id", "event_type", "source", "source_version", "signing_key_id")) {
            val value = event.opt(field)
            if (value !is String || value.isEmpty()) errors.add("$field must be a non-empty string")
        }
        if (event.optString("severity") !in SEVERITIES) errors.add("severity is not a v0 value")
        val eventVersion = event.opt("event_version")
        if (eventVersion !is Int && eventVersion !is Long) {
            errors.add("event_version must be a positive integer")
        } else if ((eventVersion as? Int ?: (eventVersion as Long).toInt()) < 1) {
            errors.add("event_version must be a positive integer")
        }

        val issuedAt = parseTimeOrNull(event.optString("issued_at", null))
        if (issuedAt == null) errors.add("issued_at must be an RFC 3339 timestamp")
        val expiresAt = parseTimeOrNull(event.optString("expires_at", null))
        if (expiresAt == null) errors.add("expires_at must be an RFC 3339 timestamp")
        if (issuedAt != null && expiresAt != null && expiresAt.isBefore(issuedAt)) {
            errors.add("expires_at must not precede issued_at")
        }

        val geometry = event.opt("geometry")
        if (geometry !is JSONObject || geometry.optString("type", "").isEmpty()) {
            errors.add("geometry must be a GeoJSON geometry object")
        } else if (geometry.optString("type") == "GeometryCollection") {
            if (!geometry.has("geometries") || geometry.opt("geometries") !is org.json.JSONArray) {
                errors.add("geometry.geometries must be an array")
            }
        } else if (!geometry.has("coordinates") || geometry.opt("coordinates") !is org.json.JSONArray) {
            errors.add("geometry.coordinates must be an array")
        }

        if (event.opt("attributes") !is JSONObject) errors.add("attributes must be an object")

        val payloadHash = event.optString("payload_hash", "")
        if (!SHA256_RE.matcher(payloadHash).matches()) errors.add("payload_hash must match sha256:<64 hex characters>")

        val signature = event.optString("signature", "")
        if (signature.length < 4 || !BASE64_RE.matcher(signature).matches()) errors.add("signature must be base64")

        if (event.optString("signature_algorithm") != "Ed25519") errors.add("signature_algorithm must be Ed25519")

        val provenance = event.opt("provenance")
        if (provenance !is JSONObject) {
            errors.add("provenance must be an object")
        } else {
            val originalSource = provenance.opt("original_source")
            if (originalSource !is String || originalSource.isEmpty()) {
                errors.add("provenance.original_source must be a non-empty string")
            }
            if (parseTimeOrNull(provenance.optString("received_at", null)) == null) {
                errors.add("provenance.received_at must be an RFC 3339 timestamp")
            }
            val transportSource = provenance.opt("transport_source")
            if (transportSource !is JSONObject || transportSource.optString("kind", "").isEmpty()) {
                errors.add("provenance.transport_source.kind is required")
            }
        }
        return errors
    }

    fun parseTimeOrNull(value: String?): Instant? {
        if (value.isNullOrEmpty()) return null
        return try {
            Instant.parse(value)
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
