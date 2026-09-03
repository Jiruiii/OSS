import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

import { canonicalize } from './canonical.mjs';

export function generateEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

export function readPrivateKey(pem) {
  return createPrivateKey(pem);
}

export function readPublicKey(pem) {
  return createPublicKey(pem);
}

export function exportPrivateKeyPem(privateKey) {
  return privateKey.export({ format: 'pem', type: 'pkcs8' });
}

export function exportPublicKeyPem(publicKey) {
  return publicKey.export({ format: 'pem', type: 'spki' });
}

export function signCanonical(value, privateKey) {
  const bytes = Buffer.from(canonicalize(value), 'utf8');
  return sign(null, bytes, privateKey).toString('base64');
}

export function verifyCanonical(value, signature, publicKey) {
  try {
    const bytes = Buffer.from(canonicalize(value), 'utf8');
    return verify(
      null,
      bytes,
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
