import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkNeihuExpectations,
  loadNeihuFixture,
  replayNeihuFixture,
} from '../lib/neihu-replay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const NEIHU = path.join(ROOT, 'data', 'fixtures', 'neihu');
const MANIFEST_PATH = path.join(NEIHU, 'manifest.json');
const EXPECTED = JSON.parse(readFileSync(path.join(NEIHU, 'expected-results.json'), 'utf8'));
const EARLY = '2026-09-04T04:30:00Z';
const LATE = EXPECTED.evaluation_time;

test('loads a deterministic 100-record Neihu fixture and preserves Raw exclusions', () => {
  const fixture = loadNeihuFixture(MANIFEST_PATH);
  const eventUpdates = fixture.updates.filter((update) => update.kind === 'event');

  assert.equal(fixture.events.length + eventUpdates.length, 100);
  assert.equal(fixture.features.length, 1);
  assert.equal(fixture.rawSnapshots.length, 2);
  assert.equal(fixture.rawSnapshots.reduce((total, snapshot) => total + snapshot.records.length, 0), 3);
  assert.ok(fixture.rawSnapshots.some((snapshot) => snapshot.records.some((record) => record.in_neihu === false)));
});

test('replays road, hazard, shelter and crowd transitions with namespace isolation', () => {
  const result = replayNeihuFixture(loadNeihuFixture(MANIFEST_PATH), LATE);

  assert.deepEqual(result.counts, EXPECTED.counts);
  assert.equal(result.current.length, EXPECTED.current_count);
  assert.equal(result.expired, EXPECTED.expired_count);

  const road = result.current.find((event) => event.namespace === 'official.tdx' && event.event_id === 'road:382');
  const crowd = result.current.find((event) => event.namespace === 'crowd.road' && event.event_id === 'road:382');
  const shelter = result.current.find((event) => event.namespace === 'official.fire' && event.event_id === 'shelter:001');
  const flood = result.current.find((event) => event.namespace === 'official.ncdr' && event.event_id === 'flood:001');
  const warning = result.current.find((event) => event.namespace === 'official.cwa' && event.event_id === 'warning:001');

  assert.equal(road.event_version, 2);
  assert.equal(road.state, 'current');
  assert.equal(crowd.state, 'unverified');
  assert.equal(shelter.event_version, 3);
  assert.equal(shelter.status, 'CLOSED');
  assert.equal(flood.event_version, 2);
  assert.equal(warning.state, 'expired');
});

test('keeps a CWA warning current before expiry and expired in the later projection', () => {
  const fixture = loadNeihuFixture(MANIFEST_PATH);
  const early = replayNeihuFixture(fixture, EARLY);
  const late = replayNeihuFixture(fixture, LATE);
  const earlyWarning = early.current.find((event) => event.event_id === 'warning:001');
  const lateWarning = late.current.find((event) => event.event_id === 'warning:001');

  assert.equal(earlyWarning.state, 'current');
  assert.equal(early.expired, 0);
  assert.equal(lateWarning.state, 'expired');
  assert.equal(late.expired, 1);
});

test('replaces a repeated static hospital snapshot without changing its content', () => {
  const result = replayNeihuFixture(loadNeihuFixture(MANIFEST_PATH), LATE);
  const hospital = result.featureLayers.find((feature) => feature.feature_id === 'hospital:001');

  assert.equal(hospital.snapshot_version, 2);
  assert.equal(hospital.source_version, 'medical-snapshot-2');
  assert.equal(hospital.unchanged_snapshot_count, 1);
  assert.equal(hospital.content_state, 'unchanged');
});

test('replay is idempotent and matches checked-in expectations', () => {
  const fixture = loadNeihuFixture(MANIFEST_PATH);
  const first = replayNeihuFixture(fixture, LATE);
  const second = replayNeihuFixture(fixture, LATE);

  assert.deepEqual(second, first);
  assert.deepEqual(checkNeihuExpectations(first, EXPECTED), []);
});
