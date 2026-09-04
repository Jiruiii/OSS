import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../lib/bundle.mjs';
import { generateEd25519KeyPair } from '../lib/crypto.mjs';
import { signEvent, verifyBundle } from '../lib/contract.mjs';
import { normalizeSource } from '../lib/normalize.mjs';
import { bboxOfEvents, bboxContains } from '../lib/geo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const NEIHU = path.join(ROOT, 'fixtures', 'neihu');
const { privateKey, publicKey } = generateEd25519KeyPair();
const KEY_ID = 'test-neihu-2026';

function bundleFromFixture(name, targetSizeBytes = 4096) {
  const raw = JSON.parse(readFileSync(path.join(NEIHU, name), 'utf8'));
  const events = normalizeSource(raw, { signingKeyId: KEY_ID }).map((event) => signEvent(event, privateKey));
  return buildBundle(events, {
    datasetId: raw.dataset_id,
    namespace: 'official',
    datasetVersion: raw.dataset_version,
    source: raw.source,
    sourceVersion: raw.source_version,
    createdAt: raw.retrieved_at,
    expiresAt: raw.expires_at,
    signingKeyId: KEY_ID,
    privateKey,
    targetSizeBytes,
  });
}

test('the committed Neihu fixtures match a fresh deterministic generation', () => {
  execFileSync('node', [path.join(ROOT, 'tools', 'generate-neihu-fixtures.mjs'), '--check'], {
    stdio: 'pipe',
  });
});

test('the curated demo fixture spans every area and theme', () => {
  const raw = JSON.parse(readFileSync(path.join(NEIHU, 'demo-v136.json'), 'utf8'));
  const areas = new Set(raw.records.map((record) => record.area_id));
  const themes = new Set(raw.records.map((record) => record.theme));
  assert.deepEqual([...areas].sort(), ['neihu.dahu', 'neihu.donghu', 'neihu.tech-park', 'neihu.wende', 'neihu.xihu']);
  assert.deepEqual([...themes].sort(), ['flood', 'landslide', 'medical', 'road', 'shelter', 'transit']);
});

test('the curated demo bundle produces one chunk per (area, theme) and verifies', () => {
  const bundle = bundleFromFixture('demo-v136.json');
  assert.ok(bundle.chunks.length > 1);
  const keys = bundle.chunks.map((chunk) => `${chunk.area_id}/${chunk.theme}`);
  assert.equal(new Set(keys).size, keys.length, 'no bucket should split at the demo size');
  const verification = verifyBundle(bundle, publicKey, { trustedKeyIds: [KEY_ID], now: new Date('2026-09-01T10:00:00Z') });
  assert.equal(verification.valid, true);
  for (const chunk of bundle.chunks) {
    assert.deepEqual(chunk.bbox, bboxOfEvents(chunk.events));
    for (const event of chunk.events) assert.ok(bboxContains(chunk.bbox, bboxOfEvents([event])));
  }
});

test('the scale fixture stays a multi-chunk dataset (regression on "always one chunk")', () => {
  const raw = JSON.parse(readFileSync(path.join(NEIHU, 'scale-v136.json'), 'utf8'));
  assert.ok(raw.records.length >= 400, `expected a large dataset, got ${raw.records.length}`);
  const bundle = bundleFromFixture('scale-v136.json', 8192);
  assert.ok(bundle.chunks.length > 10, `expected many chunks, got ${bundle.chunks.length}`);
  const verification = verifyBundle(bundle, publicKey, { trustedKeyIds: [KEY_ID], now: new Date('2026-09-01T10:00:00Z') });
  assert.equal(verification.valid, true);
});
