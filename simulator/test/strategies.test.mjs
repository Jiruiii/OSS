import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildScenario } from '../lib/scenario.mjs';
import { runSimulation } from '../lib/engine.mjs';
import { placeNodes } from '../lib/world.mjs';
import { filterManifestEntries, isRelevant } from '../lib/geo-filter.mjs';
import { transferChunk } from '../lib/transfer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'sim-config.json'), 'utf8'));
const SCENARIO = buildScenario();

const SEED = 20260904;
const NODES = 20;

function cellularBytes(strategy, geoFilter) {
  const run = runSimulation({ scenario: SCENARIO, config: CONFIG, nodeCount: NODES, strategy, seed: SEED, geoFilter });
  return run.nodes.reduce((sum, node) => sum + node.cellularBytes, 0);
}

test('cellular bytes: rarest-first <= replication <= no-coop', () => {
  const noCoop = cellularBytes('no-coop', false);
  const replication = cellularBytes('replication', false);
  const rarestFirst = cellularBytes('rarest-first', false);
  assert.ok(replication <= noCoop, `replication ${replication} <= no-coop ${noCoop}`);
  assert.ok(rarestFirst <= replication, `rarest-first ${rarestFirst} <= replication ${replication}`);
});

test('the geo-relevance filter cuts cellular bytes for cooperative strategies', () => {
  for (const strategy of ['replication', 'rarest-first']) {
    const off = cellularBytes(strategy, false);
    const on = cellularBytes(strategy, true);
    assert.ok(on < off, `${strategy}: geo-filter on ${on} < off ${off}`);
  }
});

test('the geo-relevance filter also cuts no-coop cellular bytes', () => {
  assert.ok(cellularBytes('no-coop', true) < cellularBytes('no-coop', false));
});

test('a node still accepts a flood (area-wide) chunk from outside its area set', () => {
  const nodes = placeNodes(SCENARIO, CONFIG, NODES);
  const floodEntry = SCENARIO.manifest.chunks.find((entry) => entry.theme === 'flood');
  assert.ok(floodEntry, 'scenario has a flood chunk');
  const outsider = nodes.find((node) => !node.areaSet.has(floodEntry.area_id));
  assert.ok(outsider, 'a node exists whose area set excludes the flood chunk area');
  assert.equal(isRelevant(floodEntry, outsider), true, 'flood chunk bypasses the filter');

  const localEntry = SCENARIO.manifest.chunks.find(
    (entry) => entry.theme !== 'flood' && !outsider.areaSet.has(entry.area_id),
  );
  assert.equal(isRelevant(localEntry, outsider), false, 'a non-flood far chunk is filtered out');
});

test('geo-filter never grows the needed set', () => {
  const [node] = placeNodes(SCENARIO, CONFIG, NODES);
  const all = SCENARIO.manifest.chunks;
  const filtered = filterManifestEntries(all, node, true);
  assert.ok(filtered.length < all.length);
  assert.ok(filtered.every((entry) => all.includes(entry)));
});

test('a tampered chunk delivered by a peer is rejected, not applied', () => {
  const nodes = placeNodes(SCENARIO, CONFIG, 2);
  const [src, dst] = nodes;
  const entry = SCENARIO.manifest.chunks[0];
  const authentic = SCENARIO.chunksById.get(entry.chunk_id);
  const tampered = structuredClone(authentic);
  tampered.area_id = tampered.area_id === 'neihu.dahu' ? 'neihu.xihu' : 'neihu.dahu';

  const result = transferChunk(
    SCENARIO,
    { ...CONFIG, transfer_failure_prob: 0 },
    src,
    dst,
    entry.chunk_id,
    SEED,
    0,
    0,
    SCENARIO.clock.issued_at,
    tampered,
  );
  assert.equal(result.outcome, 'rejected');
  assert.ok(!dst.heldChunks.has(entry.chunk_id), 'tampered chunk is not held');
  assert.equal(dst.appliedRound.size, 0, 'nothing applied toward coverage');
  assert.equal(dst.failedRxBytes, entry.size_bytes);
});
