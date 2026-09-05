#!/usr/bin/env node
// Generates THREE real, Ed25519-signed chunk-v0 fixtures at three
// different priorities (CRITICAL/HIGH/LOW) for the critical-first
// scheduling real-device check (docs/jia-task-sequence.md item 9 —
// the half of "Peer 上限與 critical-first 排程" that two devices can
// actually exercise; "Peer 上限" itself needs 3+ devices).
//
// Separate script (and separate key_id) from
// generate-peer-sync-chunk-fixture.mjs on purpose: that script's key_id
// (peer-sync-demo-2026) signs the chunk the 3a-milestone/resume tests
// already depend on. Re-running any generator calls generateEd25519KeyPair()
// fresh every time, so reusing that key_id here would overwrite the trusted
// public key and invalidate the chunk those other tests still verify
// against. This script uses its own key_id (peer-sync-priority-demo-2026),
// added alongside the existing entries in trust/trusted-keys.json, not
// replacing any of them.
//
// Each event sits in its own (area_id, theme) bucket so groupEvents() (see
// pipeline/lib/bundle.mjs) puts it in its own chunk — three events in, three
// chunks out. Severities are chosen from {LOW, HIGH, CRITICAL} only: bundle.mjs's
// PRIORITY_RANK has no entry for the schema's "MEDIUM" severity value, so a
// MEDIUM-severity event would silently fail to raise a chunk's priority
// above LOW — a pre-existing pipeline quirk, not something this fixture
// script should route around by accident.
//
// Re-run with: node pipeline/tools/generate-peer-sync-priority-chunks-fixture.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateEd25519KeyPair } from '../lib/crypto.mjs';
import { signEvent } from '../lib/contract.mjs';
import { buildBundle } from '../lib/bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const KEY_ID = 'peer-sync-priority-demo-2026';

const { privateKey, publicKey } = generateEd25519KeyPair();

function baseEvent(overrides) {
  return {
    schema_version: 'event-v0',
    issued_at: '2026-09-05T15:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    signing_key_id: KEY_ID,
    provenance: {
      original_source: 'fixture-peer-sync-priority-chunks',
      received_at: '2026-09-05T15:00:10Z',
      transport_source: { kind: 'server', node_id: 'fixture-ingest' },
    },
    ...overrides,
  };
}

// CRITICAL — flood warning, neihu.donghu/flood
const criticalEvent = signEvent(
  baseEvent({
    namespace: 'official.cwa',
    event_id: 'flood:donghu-01',
    event_type: 'FLOOD_WARNING',
    geometry: { type: 'Point', coordinates: [121.5750, 25.0810] },
    severity: 'CRITICAL',
    source: 'CWA',
    source_version: 'warn-20260905-01',
    event_version: 1,
    attributes: {
      alert_type: 'FLASH_FLOOD',
      status: 'ACTIVE',
      area_id: 'neihu.donghu',
      theme: 'flood',
    },
  }),
  privateKey,
);

// HIGH — road closure, neihu.wende/road
const highEvent = signEvent(
  baseEvent({
    namespace: 'official.tdx',
    event_id: 'road:wende-01',
    event_type: 'ROAD_STATUS',
    geometry: {
      type: 'LineString',
      coordinates: [[121.5890, 25.0795], [121.5920, 25.0810]],
    },
    severity: 'HIGH',
    source: 'TDX',
    source_version: '135',
    event_version: 1,
    attributes: {
      status: 'CLOSED',
      road_name: '內湖區文德路測試路段',
      area_id: 'neihu.wende',
      theme: 'road',
    },
  }),
  privateKey,
);

// LOW — informational medical station update, neihu.dahu/medical
const lowEvent = signEvent(
  baseEvent({
    namespace: 'official.medical',
    event_id: 'medical:dahu-02',
    event_type: 'MEDICAL_STATION_STATUS',
    geometry: { type: 'Point', coordinates: [121.6001, 25.0831] },
    severity: 'LOW',
    source: 'HEALTH_BUREAU',
    source_version: '2026-09-05',
    event_version: 1,
    attributes: {
      status: 'OPEN',
      note: 'routine staffing update',
      area_id: 'neihu.dahu',
      theme: 'medical',
    },
  }),
  privateKey,
);

const bundleOptions = {
  datasetId: 'resilientgeo-demo',
  namespace: 'official',
  datasetVersion: 136,
  source: 'MULTI',
  sourceVersion: '2026-09-05',
  createdAt: '2026-09-05T15:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  signingKeyId: KEY_ID,
  privateKey,
};

// One buildBundle() call per event so each becomes chunk sequence=0 within
// its own (area_id, theme) bucket — matches how a real multi-contact
// dataset would actually be organized (each theme/area chunked
// independently), not an artifact of calling buildBundle() three times.
const chunks = [criticalEvent, highEvent, lowEvent].map((event) => {
  const { chunks: builtChunks } = buildBundle([event], bundleOptions);
  if (builtChunks.length !== 1) {
    throw new Error(`expected exactly one chunk for a single event, got ${builtChunks.length}`);
  }
  return builtChunks[0];
});

const expectedPriorities = ['CRITICAL', 'HIGH', 'LOW'];
chunks.forEach((chunk, i) => {
  if (chunk.priority !== expectedPriorities[i]) {
    throw new Error(`chunk ${i} (${chunk.chunk_id}) expected priority ${expectedPriorities[i]}, got ${chunk.priority}`);
  }
});

const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
const newKeyBase64 = spkiDer.toString('base64');

const targets = [
  path.join(ROOT, 'android/app/src/main/assets'),
  path.join(ROOT, 'android/app/src/test/resources'),
];
for (const targetDir of targets) {
  const chunkDir = path.join(targetDir, 'fixtures/peer-sync');
  await mkdir(chunkDir, { recursive: true });
  for (const chunk of chunks) {
    const fileName = `chunk-136-${chunk.area_id.split('.').pop()}-${chunk.theme}-000.json`;
    await writeFile(path.join(chunkDir, fileName), `${JSON.stringify(chunk, null, 2)}\n`, 'utf8');
  }

  const trustedKeysPath = path.join(targetDir, 'trust/trusted-keys.json');
  const existing = JSON.parse(await readFile(trustedKeysPath, 'utf8'));
  existing[KEY_ID] = newKeyBase64;
  await writeFile(trustedKeysPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

console.log(`wrote 3 priority-test chunks, added trust key "${KEY_ID}" into:\n${targets.map((t) => `  ${t}`).join('\n')}`);
for (const chunk of chunks) {
  console.log(`  ${chunk.priority.padEnd(8)} ${chunk.chunk_id}  chunk_hash=${chunk.chunk_hash}  size_bytes=${chunk.byte_length}`);
}
