package com.resilientgeo.mesh.trust

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.crypto.util.PublicKeyFactory
import org.bouncycastle.util.encoders.Base64
import java.nio.charset.StandardCharsets

/**
 * Android-side signature verification adapter.
 *
 * `pipeline/lib/crypto.mjs` is a platform-neutral Node verifier built on
 * Node's `node:crypto`. Android has no equivalent Ed25519 support below API
 * 33, so this adapter uses Bouncy Castle instead and deliberately avoids
 * `android.util.Base64` / `java.util.Base64` (the latter is API 26+) so the
 * same class runs unmodified as a plain JVM unit test and on-device from
 * API 24 up.
 */
object Ed25519Verifier {

    /** `publicKeySpkiBase64` is the base64 of an SPKI DER-encoded Ed25519 public key, as produced by
     *  Node's `publicKey.export({ format: 'der', type: 'spki' })`. */
    fun parsePublicKeySpkiBase64(publicKeySpkiBase64: String): Ed25519PublicKeyParameters {
        val der = Base64.decode(publicKeySpkiBase64)
        val keyParams = PublicKeyFactory.createKey(der)
        return keyParams as? Ed25519PublicKeyParameters
            ?: throw IllegalArgumentException("SPKI does not encode an Ed25519 public key")
    }

    /** `canonicalMessage` is the canonical JSON string that was signed (see [Canonical]). */
    fun verify(canonicalMessage: String, signatureBase64: String, publicKey: Ed25519PublicKeyParameters): Boolean {
        return try {
            val message = canonicalMessage.toByteArray(StandardCharsets.UTF_8)
            val signature = Base64.decode(signatureBase64)
            val verifier = Ed25519Signer()
            verifier.init(false, publicKey)
            verifier.update(message, 0, message.size)
            verifier.verifySignature(signature)
        } catch (_: Exception) {
            false
        }
    }
}
