import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../lib/bundle.mjs';
import { generateEd25519KeyPair } from '../lib/crypto.mjs';
import {
  ingestEvent,
  signEvent,
  verifyBundle,
  verifyChunk,
  verifyEvent,
} from '../lib/contract.mjs';
import { normalizeTdx } from '../lib/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RAW = JSON.parse(readFileSync(path.join(ROOT, 'pipeline/sources/tdx-fixture.json'), 'utf8'));
const KEY_ID = 'test-stage2-2026';
const NOW = new Date('2026-09-01T08:00:00Z');
const { privateKey, publicKey } = generateEd25519KeyPair();

function makeEvent(eventVersion = 1, recordOverrides = {}, namespace = 'official.tdx') {
  const record = {
    ...RAW.records[0],
    event_version: eventVersion,
    ...recordOverrides,
  };
  const raw = {
    ...RAW,
    expires_at: record.expires_at,
    records: [record],
  };
  const [unsigned] = normalizeTdx(raw, {
    namespace,
    signingKeyId: KEY_ID,
    receivedAt: RAW.retrieved_at,
  });
  return signEvent(unsigned, privateKey);
}

const validEvent = makeEvent(1);

test('normalizes one TDX record and signs a verifiable Event v0', () => {
  assert.equal(validEvent.schema_version, 'event-v0');
  assert.equal(validEvent.event_id, 'road:382');
  assert.equal(validEvent.source, 'TDX');
  assert.match(validEvent.payload_hash, /^sha256:[0-9a-f]{64}$/);
  const verification = verifyEvent(validEvent, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.current, true);
});

test('builds and verifies a signed manifest and chunk bundle', () => {
  const bundle = buildBundle([validEvent], {
    datasetId: 'resilientgeo-demo',
    namespace: 'official',
    datasetVersion: 136,
    source: 'TDX',
    sourceVersion: '136',
    createdAt: '2026-09-01T07:10:05Z',
    expiresAt: '2026-09-01T09:10:00Z',
    signingKeyId: KEY_ID,
    privateKey,
  });
  assert.equal(bundle.manifest.chunks.length, 1);
  assert.equal(bundle.manifest.total_event_count, 1);
  const verification = verifyBundle(bundle, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.chunks[0].valid, true);
});

test('rejects a payload tamper before it can be applied', () => {
  const tampered = structuredClone(validEvent);
  tampered.attributes.status = 'OPEN';
  const verification = verifyEvent(tampered, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(verification.valid, false);
  assert.equal(verification.stage, 'integrity');
  assert.deepEqual(verification.errors, ['payload_hash_mismatch']);
});

test('rejects a signed rollback and keeps the newer version', () => {
  const store = new Map();
  const initial = ingestEvent(store, makeEvent(1), publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  const update = ingestEvent(store, makeEvent(2, { reason: 'debris' }), publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  const rollback = ingestEvent(store, makeEvent(1, { status: 'OPEN', reason: 'replay' }), publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(initial.result, 'inserted');
  assert.equal(update.result, 'updated');
  assert.equal(rollback.result, 'rejected');
  assert.equal(rollback.reason, 'version_rollback');
  assert.equal(store.get('official.tdx\u0000road:382').event_version, 2);
});

test('accepts an expired signed event into cache but not current state', () => {
  const expired = makeEvent(1, {
    issued_at: '2026-09-01T06:00:00Z',
    expires_at: '2026-09-01T07:00:00Z',
  });
  const verification = verifyEvent(expired, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.expired, true);
  assert.equal(verification.current, false);
  const decision = ingestEvent(new Map(), expired, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(decision.result, 'inserted');
  assert.equal(decision.state, 'expired');
});

test('rejects an incomplete chunk even when its envelope is otherwise present', () => {
  const bundle = buildBundle([validEvent], {
    datasetId: 'resilientgeo-demo',
    namespace: 'official',
    datasetVersion: 136,
    source: 'TDX',
    sourceVersion: '136',
    createdAt: '2026-09-01T07:10:05Z',
    expiresAt: '2026-09-01T09:10:00Z',
    signingKeyId: KEY_ID,
    privateKey,
  });
  const incomplete = { ...bundle.chunks[0], events: [] };
  const verification = verifyChunk(incomplete, bundle.manifest, publicKey, {
    trustedKeyIds: [KEY_ID],
    now: NOW,
  });
  assert.equal(verification.valid, false);
  assert.equal(verification.stage, 'schema');
  assert.ok(verification.errors.includes('events must be non-empty'));
});
