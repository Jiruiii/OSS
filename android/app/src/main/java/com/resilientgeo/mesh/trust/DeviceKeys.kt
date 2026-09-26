package com.resilientgeo.mesh.trust

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Kotlin port of `pipeline/lib/device-key.mjs`.
 *
 * A device key is self-certifying: `signing_key_id` must equal `device:` plus
 * the first 32 hex characters of sha256(SPKI DER) of the `signer_public_key`
 * the event carries. That proves "same device, unaltered content" and nothing
 * about truth, which is why [resolve] refuses any namespace outside `crowd.*`.
 */
object DeviceKeys {
    const val PREFIX = "device:"
    private const val FINGERPRINT_HEX_LENGTH = 32

    sealed class Resolution {
        data class Resolved(val publicKey: Ed25519PublicKeyParameters) : Resolution()
        data class Rejected(val error: String) : Resolution()
    }

    fun isDeviceKeyId(signingKeyId: String?): Boolean = signingKeyId?.startsWith(PREFIX) == true

    fun isCrowdNamespace(namespace: String?): Boolean = namespace?.startsWith("crowd.") == true

    fun keyIdFromSpkiDer(spkiDer: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(spkiDer)
        val hex = digest.joinToString("") { "%02x".format(it) }
        return PREFIX + hex.substring(0, FINGERPRINT_HEX_LENGTH)
    }

    fun keyIdFromSpkiBase64(spkiBase64: String): String =
        keyIdFromSpkiDer(org.bouncycastle.util.encoders.Base64.decode(spkiBase64))

    /** Mirrors `resolveDeviceKey()` in device-key.mjs, including its error strings. */
    fun resolve(event: JSONObject): Resolution {
        if (!isCrowdNamespace(event.optString("namespace", ""))) {
            return Resolution.Rejected("device keys may only sign crowd.* events")
        }
        val spki = event.opt("signer_public_key") as? String
        val publicKey = spki?.let {
            try {
                Ed25519Verifier.parsePublicKeySpkiBase64(it)
            } catch (_: Exception) {
                null
            }
        } ?: return Resolution.Rejected("signer_public_key is not an Ed25519 SPKI key")
        if (keyIdFromSpkiBase64(spki) != event.optString("signing_key_id")) {
            return Resolution.Rejected("signing_key_id does not match signer_public_key fingerprint")
        }
        return Resolution.Resolved(publicKey)
    }
}
