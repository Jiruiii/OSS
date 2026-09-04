package com.resilientgeo.mesh.trust

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.json.JSONObject

/**
 * Holds the Ed25519 public keys this device trusts, keyed by `signing_key_id`.
 *
 * Private keys never enter the app (see `system.md` section 6, phase 2);
 * this store only ever holds public material bundled at build time (assets/
 * trust/trusted-keys.json) or received from module A/C in a later phase.
 */
class TrustedKeyStore(rawKeys: Map<String, String>) {

    private val keys: Map<String, Ed25519PublicKeyParameters> =
        rawKeys.mapValues { (_, base64Spki) -> Ed25519Verifier.parsePublicKeySpkiBase64(base64Spki) }

    fun publicKeyFor(signingKeyId: String): Ed25519PublicKeyParameters? = keys[signingKeyId]

    fun isTrusted(signingKeyId: String): Boolean = keys.containsKey(signingKeyId)

    companion object {
        /** Parses the `{ "<signing_key_id>": "<base64 SPKI DER>" }` shape shipped in assets/trust/trusted-keys.json. */
        fun fromJson(json: String): TrustedKeyStore {
            val obj = JSONObject(json)
            val map = mutableMapOf<String, String>()
            for (key in obj.keys()) {
                map[key] = obj.getString(key)
            }
            return TrustedKeyStore(map)
        }
    }
}
