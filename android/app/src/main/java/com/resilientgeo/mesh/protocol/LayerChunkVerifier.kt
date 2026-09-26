package com.resilientgeo.mesh.protocol

import com.resilientgeo.mesh.trust.Canonical
import com.resilientgeo.mesh.trust.FeatureVerifier
import com.resilientgeo.mesh.trust.TrustedKeyStore
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

data class LayerVerificationResult(
    val valid: Boolean,
    val stage: Stage,
    val errors: List<String> = emptyList(),
    val features: List<JSONObject> = emptyList(),
) {
    enum class Stage { SCHEMA, TRUST, INTEGRITY, SIGNATURE, FEATURE }
}

/** Verifies one `layer-chunk-v0` package before the map can consume it. */
object LayerChunkVerifier {

    private val HASH_FIELDS = listOf(
        "dataset_id", "layer_id", "namespace", "dataset_version", "sequence", "priority",
        "created_at", "content_type", "content_encoding", "features",
    )

    private val REQUIRED_FIELDS = listOf(
        "schema_version", "chunk_id", "manifest_id", "dataset_id", "layer_id", "namespace",
        "dataset_version", "sequence", "priority", "created_at", "content_type",
        "content_encoding", "feature_count", "features", "byte_length", "chunk_hash",
        "manifest_hash", "signature_algorithm", "signing_key_id", "signature",
    )

    fun verify(chunk: JSONObject, trustStore: TrustedKeyStore): LayerVerificationResult {
        val shapeErrors = validateShape(chunk)
        if (shapeErrors.isNotEmpty()) return LayerVerificationResult(false, LayerVerificationResult.Stage.SCHEMA, shapeErrors)

        val signingKeyId = chunk.getString("signing_key_id")
        val publicKey = trustStore.publicKeyFor(signingKeyId)
            ?: return LayerVerificationResult(false, LayerVerificationResult.Stage.TRUST, listOf("signing_key_id is not trusted"))

        val expectedHash = Canonical.sha256Canonical(hashContent(chunk))
        if (expectedHash != chunk.getString("chunk_hash")) {
            return LayerVerificationResult(false, LayerVerificationResult.Stage.INTEGRITY, listOf("chunk_hash_mismatch"))
        }
        val signatureInput = JSONObject(chunk.toString()).apply { remove("signature") }
        if (!com.resilientgeo.mesh.trust.Ed25519Verifier.verify(
                Canonical.canonicalize(signatureInput),
                chunk.getString("signature"),
                publicKey,
            )) {
            return LayerVerificationResult(false, LayerVerificationResult.Stage.SIGNATURE, listOf("chunk_signature_invalid"))
        }

        val featuresJson = chunk.getJSONArray("features")
        val features = (0 until featuresJson.length()).map { featuresJson.getJSONObject(it) }
        for (feature in features) {
            val result = FeatureVerifier.verify(feature, trustStore)
            if (!result.valid) {
                return LayerVerificationResult(false, LayerVerificationResult.Stage.FEATURE, result.errors.map { "feature_invalid:$it" })
            }
        }
        return LayerVerificationResult(true, LayerVerificationResult.Stage.SIGNATURE, features = features)
    }

    private fun hashContent(chunk: JSONObject): JSONObject {
        val content = JSONObject()
        for (field in HASH_FIELDS) content.put(field, chunk.get(field))
        return content
    }

    private fun validateShape(chunk: JSONObject): List<String> {
        val errors = mutableListOf<String>()
        for (field in REQUIRED_FIELDS) if (!chunk.has(field)) errors += "missing required field: $field"
        if (chunk.optString("schema_version") != "layer-chunk-v0") errors += "schema_version must be layer-chunk-v0"
        for (field in listOf("chunk_id", "manifest_id", "dataset_id", "layer_id", "namespace", "priority", "created_at", "content_type", "content_encoding", "chunk_hash", "manifest_hash", "signature_algorithm", "signing_key_id")) {
            if (chunk.opt(field) !is String || chunk.optString(field).isEmpty()) errors += "$field must be a non-empty string"
        }
        if (chunk.opt("features") !is JSONArray) errors += "features must be an array"
        val features = chunk.optJSONArray("features")
        if (features != null && chunk.optInt("feature_count", -1) != features.length()) errors += "feature_count mismatch"
        if (chunk.optString("signature_algorithm") != "Ed25519") errors += "signature_algorithm must be Ed25519"
        if (!Regex("^sha256:[0-9a-fA-F]{64}$").matches(chunk.optString("chunk_hash", ""))) errors += "chunk_hash is invalid"
        if (!Regex("^sha256:[0-9a-fA-F]{64}$").matches(chunk.optString("manifest_hash", ""))) errors += "manifest_hash is invalid"
        val signature = chunk.optString("signature", "")
        if (signature.length < 4 || !Regex("^[A-Za-z0-9+/]+={0,2}$").matches(signature)) errors += "signature is invalid"
        if (chunk.opt("dataset_version") !is Number || chunk.optInt("dataset_version", 0) < 1) errors += "dataset_version must be positive"
        if (chunk.opt("sequence") !is Number || chunk.optInt("sequence", -1) < 0) errors += "sequence must be non-negative"
        if (chunk.opt("byte_length") !is Number || chunk.optLong("byte_length", 0) < 0) errors += "byte_length must be non-negative"
        return errors
    }
}
