import { createHash, createPublicKey } from 'node:crypto';

/**
 * Device-signed crowd reports (docs/data-contract-v0.md「群眾回報簽章」).
 *
 * A phone generates its own Ed25519 key the first time it files a report and
 * ships the public half inside every event as `signer_public_key` (base64 SPKI
 * DER). The key id is derived from that public key, so a receiver needs no
 * bundled trust entry to check that the key id and the key belong together:
 *
 *   signing_key_id = "device:" + first 32 hex characters of sha256(SPKI DER)
 *
 * This proves the content was not altered and that every report carrying the
 * same key id came from the same device. It says nothing about whether the
 * report is true, which is why these keys are confined to `crowd.*`.
 */
export const DEVICE_KEY_PREFIX = 'device:';
const FINGERPRINT_HEX_LENGTH = 32;

export function isDeviceKeyId(signingKeyId) {
  return typeof signingKeyId === 'string' && signingKeyId.startsWith(DEVICE_KEY_PREFIX);
}

export function isCrowdNamespace(namespace) {
  return typeof namespace === 'string' && namespace.startsWith('crowd.');
}

export function deviceKeyIdFromSpkiDer(spkiDer) {
  const digest = createHash('sha256').update(spkiDer).digest('hex');
  return `${DEVICE_KEY_PREFIX}${digest.slice(0, FINGERPRINT_HEX_LENGTH)}`;
}

export function deviceKeyIdFromSpkiBase64(spkiBase64) {
  return deviceKeyIdFromSpkiDer(Buffer.from(spkiBase64, 'base64'));
}

export function publicKeySpkiBase64(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

export function deviceKeyIdForPublicKey(publicKey) {
  return deviceKeyIdFromSpkiBase64(publicKeySpkiBase64(publicKey));
}

/** Parses a base64 SPKI Ed25519 public key; returns null for anything else. */
export function parseDevicePublicKey(spkiBase64) {
  if (typeof spkiBase64 !== 'string' || spkiBase64.length === 0) return null;
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the public key a device-signed event must verify against, or
 * explains why it cannot. Mirrors `EventVerifier.resolveDeviceKey` in Kotlin.
 */
export function resolveDeviceKey(event) {
  if (!isCrowdNamespace(event.namespace)) {
    return { key: null, error: 'device keys may only sign crowd.* events' };
  }
  const key = parseDevicePublicKey(event.signer_public_key);
  if (!key) return { key: null, error: 'signer_public_key is not an Ed25519 SPKI key' };
  if (deviceKeyIdFromSpkiBase64(event.signer_public_key) !== event.signing_key_id) {
    return { key: null, error: 'signing_key_id does not match signer_public_key fingerprint' };
  }
  return { key, error: null };
}
