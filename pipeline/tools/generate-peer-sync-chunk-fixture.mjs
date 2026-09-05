#!/usr/bin/env node
// Generates ONE real, Ed25519-signed chunk-v0 fixture for the Android
// BleGattTransport 3a milestone (docs/jia-task-sequence.md item 7: two
// devices exchange one real signed chunk, verified into Room).
//
// This is deliberately separate from generate-android-fixture.mjs: that
// script generates a FRESH keypair every run and overwrites
// trust/trusted-keys.json wholesale, which would invalidate the existing
// signed-events.json fixture if the two were combined. This script instead
// ADDS one more key_id entry (peer-sync-demo-2026) alongside the existing
// android-demo-2026 one, and writes a single chunk-v0 JSON object that the
// "Node B" role in PeerSyncMilestoneActivity serves when Node A REQUESTs it.
//
// The chunk_id below (resilientgeo-demo:chunk:136:dahu:shelter:000) matches
// the example already written up in docs/peer-sync-v0.md.
//
// Re-run with: node pipeline/tools/generate-peer-sync-chunk-fixture.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateEd25519KeyPair } from '../lib/crypto.mjs';
import { signEvent } from '../lib/contract.mjs';
import { buildBundle } from '../lib/bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const KEY_ID = 'peer-sync-demo-2026';

const { privateKey, publicKey } = generateEd25519KeyPair();

const shelterEvent = {
  schema_version: 'event-v0',
  namespace: 'official.fire',
  event_id: 'shelter:dahu-01',
  event_type: 'SHELTER_STATUS',
  geometry: { type: 'Point', coordinates: [121.5993, 25.0825] },
  severity: 'CRITICAL',
  source: 'FIRE_AGENCY',
  source_version: '2026-09-05T12:00Z',
  event_version: 1,
  issued_at: '2026-09-05T12:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  attributes: {
    status: 'OPEN',
    capacity: 200,
    available: 80,
    // groupEvents() (pipeline/lib/bundle.mjs) buckets chunks by these two
    // fields; chosen to match the chunk_id already written up in
    // docs/peer-sync-v0.md (…:dahu:shelter:000).
    area_id: 'neihu.dahu',
    theme: 'shelter',
  },
  signing_key_id: KEY_ID,
  provenance: {
    original_source: 'fixture-peer-sync-chunk',
    received_at: '2026-09-05T12:00:10Z',
    transport_source: { kind: 'server', node_id: 'fixture-ingest' },
  },
};

const signedEvent = signEvent(shelterEvent, privateKey);

const { chunks } = buildBundle([signedEvent], {
  datasetId: 'resilientgeo-demo',
  namespace: 'official',
  datasetVersion: 136,
  source: 'FIRE_AGENCY',
  sourceVersion: '2026-09-05',
  createdAt: '2026-09-05T12:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  signingKeyId: KEY_ID,
  privateKey,
});

if (chunks.length !== 1) {
  throw new Error(`expected exactly one chunk for a single event, got ${chunks.length}`);
}
const chunk = chunks[0];
if (chunk.chunk_id !== 'resilientgeo-demo:chunk:136:dahu:shelter:000') {
  throw new Error(`chunk_id drifted from the docs/peer-sync-v0.md example: got ${chunk.chunk_id}`);
}

const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
const newKeyBase64 = spkiDer.toString('base64');

const chunkJson = `${JSON.stringify(chunk, null, 2)}\n`;

const targets = [
  path.join(ROOT, 'android/app/src/main/assets'),
  path.join(ROOT, 'android/app/src/test/resources'),
];
for (const targetDir of targets) {
  const chunkDir = path.join(targetDir, 'fixtures/peer-sync');
  await mkdir(chunkDir, { recursive: true });
  await writeFile(path.join(chunkDir, 'chunk-136-dahu-shelter-000.json'), chunkJson, 'utf8');

  const trustedKeysPath = path.join(targetDir, 'trust/trusted-keys.json');
  const existing = JSON.parse(await readFile(trustedKeysPath, 'utf8'));
  existing[KEY_ID] = newKeyBase64;
  await writeFile(trustedKeysPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

console.log(`wrote fixtures/peer-sync/chunk-136-dahu-shelter-000.json, added trust key "${KEY_ID}" into:\n${targets.map((t) => `  ${t}`).join('\n')}`);
console.log(`chunk_hash=${chunk.chunk_hash}`);
