import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eventState, ingestEvent, signEvent, verifyEvent } from '../lib/contract.mjs';
import {
  CROWD_CHUNK_MAX_BYTES,
  buildCrowdChunk,
  buildCrowdReport,
  verifyCrowdChunk,
} from '../lib/crowd-report.mjs';
import { deviceKeyIdForPublicKey, publicKeySpkiBase64 } from '../lib/device-key.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/crowd-reports-v0.json'), 'utf8'));
const officialKey = {
  key: Buffer.from(fixture.official_public_key, 'base64'),
  format: 'der',
  type: 'spki',
};
const NOW = fixture.now;

function report(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const event = buildCrowdReport({
    category: 'FLOOD',
    description: '地下道積水約 30 公分',
    lon: 121.5761,
    lat: 25.0795,
    locationSource: 'CURRENT_LOCATION',
    issuedAt: new Date('2026-09-24T00:00:00Z'),
    privateKey,
    publicKey,
    ...overrides,
  });
  return { event, privateKey, publicKey };
}

for (const testCase of fixture.event_cases) {
  test(`fixture event case ${testCase.name}`, async () => {
    const { createPublicKey } = await import('node:crypto');
    const result = verifyEvent(testCase.event, createPublicKey(officialKey), {
      trustedKeyIds: [fixture.official_key_id],
      now: NOW,
    });
    assert.equal(result.valid, testCase.expect.valid, JSON.stringify(result));
    if (testCase.expect.valid) {
      assert.equal(eventState(testCase.event, new Date(NOW)), testCase.expect.state);
    } else {
      assert.equal(result.stage, testCase.expect.stage, JSON.stringify(result));
    }
  });
}

for (const testCase of fixture.chunk_cases) {
  test(`fixture chunk case ${testCase.name}`, () => {
    const result = verifyCrowdChunk(testCase.chunk, { now: NOW });
    assert.equal(result.valid, testCase.expect.valid, JSON.stringify(result));
    if (!testCase.expect.valid) assert.equal(result.errors[0], testCase.expect.error);
  });
}

test('a device-signed report never needs a bundled trust entry', () => {
  const { event } = report();
  const result = verifyEvent(event, null, { trustedKeyIds: ['some-official-key'], now: NOW });
  assert.equal(result.valid, true);
  assert.equal(eventState(event, new Date(NOW)), 'unverified');
});

test('the key id is the SPKI fingerprint and the private key never leaves the builder', () => {
  const { event, publicKey } = report();
  assert.equal(event.signing_key_id, deviceKeyIdForPublicKey(publicKey));
  assert.match(event.signing_key_id, /^device:[0-9a-f]{32}$/);
  assert.equal(event.signer_public_key, publicKeySpkiBase64(publicKey));
  assert.match(event.event_id, new RegExp(`^report:${event.signing_key_id.slice(-8)}:[0-9a-f-]{36}$`));
  assert.ok(!JSON.stringify(event).includes('PRIVATE'));
});

test('a device key listed as trusted still cannot sign official.* events', () => {
  // Pins the Global Constraint: relaxing crowd trust must not loosen official trust.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = deviceKeyIdForPublicKey(publicKey);
  const forged = signEvent({
    schema_version: 'event-v0',
    namespace: 'official.cwa',
    event_id: 'flood:forged-001',
    event_type: 'FLOOD_WARNING',
    geometry: { type: 'Point', coordinates: [121.58, 25.08] },
    severity: 'CRITICAL',
    source: 'CWA',
    source_version: 'forged',
    event_version: 1,
    issued_at: '2026-09-24T00:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    attributes: {},
    signing_key_id: keyId,
    signer_public_key: publicKeySpkiBase64(publicKey),
    provenance: {
      original_source: 'forged',
      received_at: '2026-09-24T00:00:00Z',
      transport_source: { kind: 'peer' },
    },
  }, privateKey);
  const result = verifyEvent(forged, publicKey, { trustedKeyIds: [keyId], now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.stage, 'trust');
});

test('crowd.* events signed by a bundled trusted key keep the existing path', () => {
  // Replay fixtures (data/fixtures/neihu) and the Android signed-events fixture
  // carry crowd.* events signed by official demo keys; they must not start
  // failing because device keys were added.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const event = signEvent({
    ...structuredClone(fixture.event_cases[0].event),
    signing_key_id: 'android-demo-2026',
    signer_public_key: undefined,
  }, privateKey);
  delete event.signer_public_key;
  assert.equal(verifyEvent(event, publicKey, { trustedKeyIds: ['android-demo-2026'], now: NOW }).valid, true);
  assert.equal(verifyEvent(event, publicKey, { trustedKeyIds: ['other'], now: NOW }).stage, 'trust');
});

test('report builder rejects invalid form input', () => {
  assert.throws(() => report({ category: 'ROAD_BLOCKED' }), /category/);
  assert.throws(() => report({ description: '字'.repeat(161) }), /description/);
  assert.doesNotThrow(() => report({ description: `  ${'字'.repeat(160)}  ` }));
  assert.throws(() => report({ lon: 139.69, lat: 35.68 }), /outside/);
  assert.throws(() => report({ locationSource: 'GPS' }), /location.source/);
  assert.throws(() => report({ locationHint: { method: 'ADDRESS', query: 'x', label: 'x', kind: 'STREET', precision: 'ROAD' } }), /kind/);
});

test('report expires six hours after issue and uses local_report provenance', () => {
  const { event } = report();
  assert.equal(event.issued_at, '2026-09-24T00:00:00Z');
  assert.equal(event.expires_at, '2026-09-24T06:00:00Z');
  assert.equal(event.provenance.transport_source.kind, 'local_report');
  assert.equal(event.attributes.category, 'FLOOD');
  assert.equal(event.severity, 'HIGH');
});

test('ingest keeps crowd reports apart from official events with the same id', () => {
  const store = new Map();
  const { event } = report();
  assert.equal(ingestEvent(store, event, null, { now: NOW }).state, 'unverified');
  assert.equal(ingestEvent(store, event, null, { now: NOW }).reason, 'same_version_conflict');
});

test('crowd chunk round trip and relay rules', () => {
  const { event, privateKey } = report();
  const chunk = buildCrowdChunk(event, privateKey);
  assert.equal(chunk.chunk_id, `crowd:${event.event_id}`);
  assert.equal(chunk.manifest_id, 'crowd:none');
  assert.equal(chunk.manifest_hash, event.payload_hash);
  assert.equal(chunk.priority, 'HIGH');
  assert.equal(verifyCrowdChunk(JSON.parse(JSON.stringify(chunk)), { now: NOW }).valid, true);

  const moved = structuredClone(chunk);
  moved.bbox = [121, 25, 121, 25];
  assert.equal(verifyCrowdChunk(moved, { now: NOW }).errors[0], 'chunk_bbox_mismatch');

  const rebound = structuredClone(chunk);
  rebound.chunk_id = 'crowd:report:other';
  assert.equal(verifyCrowdChunk(rebound, { now: NOW }).errors[0], 'crowd_chunk_binding_invalid');
});

test('the worst-case legitimate report fits the crowd chunk cap', () => {
  const { event, privateKey } = report({
    description: '測'.repeat(160),
    locationHint: { method: 'ADDRESS', query: '測'.repeat(80), label: '測'.repeat(80), kind: 'FACILITY', precision: 'POINT' },
  });
  const chunk = buildCrowdChunk(event, privateKey);
  assert.ok(chunk.byte_length <= CROWD_CHUNK_MAX_BYTES, `${chunk.byte_length} bytes`);

  const padded = structuredClone(chunk);
  padded.events[0].attributes.description = '測'.repeat(1500);
  assert.equal(verifyCrowdChunk(padded, { now: NOW }).errors[0], 'crowd_chunk_too_large');
});
