#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { generateEd25519KeyPair, exportPrivateKeyPem, exportPublicKeyPem, readPrivateKey } from '../lib/crypto.mjs';
import { FEED_KEY_ID } from '../lib/government-feed.mjs';

const keyDir = '.stage2-keys/government-feed';
await mkdir(keyDir, { recursive: true });
let privateKey;
try { privateKey = readPrivateKey(await readFile(`${keyDir}/private-key.pem`)); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  privateKey = generateEd25519KeyPair().privateKey;
  await writeFile(`${keyDir}/private-key.pem`, exportPrivateKeyPem(privateKey), { mode: 0o600, flag: 'wx' });
}
const publicKey = createPublicKey(privateKey);
const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
await writeFile(`${keyDir}/public-key.pem`, exportPublicKeyPem(publicKey));
for (const name of ['android/app/src/main/assets/trust/trusted-keys.json', 'android/app/src/test/resources/trust/trusted-keys.json']) {
  const keys = JSON.parse(await readFile(name, 'utf8'));
  if (keys[FEED_KEY_ID] && keys[FEED_KEY_ID] !== spki) throw new Error('Existing app trust key differs; review key rotation explicitly');
  keys[FEED_KEY_ID] = spki;
  await writeFile(name, JSON.stringify(keys, null, 2) + '\n');
}
console.log(`Public publisher key installed. Private key remains only in ${keyDir}/private-key.pem (gitignored).`);
