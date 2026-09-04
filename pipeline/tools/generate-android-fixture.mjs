#!/usr/bin/env node
// Generates the real Ed25519-signed event fixtures the Android trust
// adapter's tests and demo screen ship with (android/app/src/main/assets/
// and the mirrored android/app/src/test/resources/ copy).
//
// These are NOT the stable placeholder tokens used by fixtures/*.json at
// the repo root (see fixtures/README.md) — they are genuinely signed with
// a freshly generated Ed25519 key, so the Android canonicalization +
// signature verification code is checked byte-for-byte against the same
// pipeline/lib module A owns, not against hand-typed base64.
//
// Re-run this whenever the Android fixture scenario needs to change:
//   node pipeline/tools/generate-android-fixture.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateEd25519KeyPair } from '../lib/crypto.mjs';
import { ingestEvent, signEvent, verifyEvent } from '../lib/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const KEY_ID = 'android-demo-2026';
const { privateKey, publicKey } = generateEd25519KeyPair();

// Demo area: Taipei Neihu district (內湖區) — matches the geography the
// rest of the team standardized on in data/fixtures/neihu/scenario.json, not
// this generator's original placeholder (Hualien-area coordinates). Seeds
// below are lifted from that scenario file's neihu.dahu / neihu.wende
// areas; road_name and status are still synthetic incident content, same
// as the rest of the neihu.* fixtures.
function baseEvent(overrides) {
  return {
    schema_version: 'event-v0',
    namespace: 'official.tdx',
    event_id: 'road:dahu-01',
    event_type: 'ROAD_STATUS',
    geometry: {
      type: 'LineString',
      coordinates: [
        [121.5993, 25.0825],
        [121.6053, 25.0850],
      ],
    },
    severity: 'HIGH',
    source: 'TDX',
    source_version: '135',
    event_version: 1,
    issued_at: '2026-09-01T06:32:00Z',
    // Far-future expiry so the bundled demo shows a genuinely "current"
    // event no matter how much later this project is actually built and
    // run, rather than going stale a few days after the fixture date.
    expires_at: '2099-01-01T00:00:00Z',
    attributes: { status: 'CLOSED', road_name: '內湖區大湖測試路段' },
    signing_key_id: KEY_ID,
    provenance: {
      original_source: 'tdx-fixture',
      received_at: '2026-09-01T06:33:00Z',
      transport_source: { kind: 'server', node_id: 'fixture-ingest' },
    },
    ...overrides,
  };
}

const roadV1 = signEvent(baseEvent({ event_version: 1 }), privateKey);
const roadV2 = signEvent(
  baseEvent({
    event_version: 2,
    attributes: { status: 'OPEN', road_name: '內湖區大湖測試路段', reason: 'debris_cleared' },
  }),
  privateKey,
);
// Deliberately expires in the past (unlike the others) so the demo always
// has one event to show in the EXPIRED state, mirroring fixtures/events-batch-1.json's
// intentionally-expired shelter:31.
const shelter = signEvent(
  baseEvent({
    event_id: 'shelter:wende-01',
    event_type: 'SHELTER_STATUS',
    namespace: 'official.fire',
    geometry: { type: 'Point', coordinates: [121.5849, 25.0786] },
    source: 'FIRE_AGENCY',
    source_version: '2026-09-01T06:20Z',
    event_version: 1,
    issued_at: '2026-09-01T06:20:00Z',
    expires_at: '2026-09-01T07:00:00Z',
    attributes: { status: 'OPEN', capacity: 300, available: 120 },
  }),
  privateKey,
);
const rain = signEvent(
  baseEvent({
    event_id: 'flood:neihu-0901-001',
    event_type: 'FLOOD_WARNING',
    namespace: 'official.cwa',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [121.565, 25.065],
        [121.615, 25.065],
        [121.615, 25.090],
        [121.565, 25.090],
        [121.565, 25.065],
      ]],
    },
    severity: 'CRITICAL',
    source: 'CWA',
    source_version: 'warn-20260901-01',
    event_version: 1,
    issued_at: '2026-09-01T06:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    attributes: { alert_type: 'HEAVY_RAIN', rainfall_mm_per_hour: 80, status: 'ACTIVE' },
  }),
  privateKey,
);
// Same event_id as the official road event but a different namespace: proves
// namespace isolation instead of colliding with it.
const crowdReport = signEvent(
  baseEvent({
    event_id: 'road:dahu-01',
    event_type: 'ROAD_STATUS',
    namespace: 'crowd.reports',
    severity: 'MEDIUM',
    source: 'CROWD',
    source_version: 'n/a',
    event_version: 1,
    issued_at: '2026-09-01T07:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    attributes: { status: 'UNKNOWN', note: 'crowd-reported, same event_id, different namespace' },
    provenance: {
      original_source: 'crowd-app',
      received_at: '2026-09-01T07:01:00Z',
      transport_source: { kind: 'peer', node_id: 'device-b' },
    },
  }),
  privateKey,
);
// A validly-signed but stale version, to demonstrate that a signature alone
// doesn't get a rollback applied once a newer version has been stored.
const rollbackAttempt = signEvent(
  baseEvent({ event_version: 1, attributes: { status: 'OPEN', road_name: '內湖區大湖測試路段', reason: 'replay-attempt' } }),
  privateKey,
);

const ALL_EVENTS = [roadV1, shelter, rain, crowdReport, roadV2, rollbackAttempt];

// Sanity: verify every event with the public key before shipping it as a fixture.
const NOW = new Date('2026-09-04T12:00:00Z');
for (const event of ALL_EVENTS) {
  const result = verifyEvent(event, publicKey, { trustedKeyIds: [KEY_ID], now: NOW });
  if (!result.valid) {
    throw new Error(`fixture event ${event.namespace}/${event.event_id}@${event.event_version} failed self-check: ${JSON.stringify(result)}`);
  }
}

// Sanity: replay the apply rules once here so a broken port shows up as a
// diff against this log, not just as a failing Kotlin assertion.
const store = new Map();
const replayLog = ALL_EVENTS.map((event) => ingestEvent(store, event, publicKey, { trustedKeyIds: [KEY_ID], now: NOW }));
console.log(JSON.stringify(replayLog.map((r) => ({ key: r.key, result: r.result, reason: r.reason, state: r.state })), null, 2));

const signedEventsJson = `${JSON.stringify({
  schema_version: 'event-batch-v0',
  description: 'Real Ed25519-signed events for the Android trust-adapter tests and demo screen. Generated by pipeline/tools/generate-android-fixture.mjs, not hand-authored.',
  key_id: KEY_ID,
  events: ALL_EVENTS,
}, null, 2)}\n`;

const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
const trustedKeysJson = `${JSON.stringify({ [KEY_ID]: spkiDer.toString('base64') }, null, 2)}\n`;

const targets = [
  path.join(ROOT, 'android/app/src/main/assets'),
  path.join(ROOT, 'android/app/src/test/resources'),
];
for (const targetDir of targets) {
  await mkdir(path.join(targetDir, 'fixtures'), { recursive: true });
  await mkdir(path.join(targetDir, 'trust'), { recursive: true });
  await writeFile(path.join(targetDir, 'fixtures/signed-events.json'), signedEventsJson, 'utf8');
  await writeFile(path.join(targetDir, 'trust/trusted-keys.json'), trustedKeysJson, 'utf8');
}

console.log(`wrote fixtures/signed-events.json and trust/trusted-keys.json into:\n${targets.map((t) => `  ${t}`).join('\n')}`);
