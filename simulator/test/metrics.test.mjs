import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildScenario } from '../lib/scenario.mjs';
import { runSimulation } from '../lib/engine.mjs';
import { computeMetrics } from '../lib/metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'sim-config.json'), 'utf8'));
const SCENARIO = buildScenario();
const SEED = 4242;

function metricsFor(strategy, geoFilter = false, nodeCount = 20) {
  const run = runSimulation({ scenario: SCENARIO, config: CONFIG, nodeCount, strategy, seed: SEED, geoFilter });
  return computeMetrics(run, SCENARIO, CONFIG);
}

test('coverage curve is monotonic non-decreasing and bounded to [0,1]', () => {
  for (const strategy of ['no-coop', 'replication', 'rarest-first']) {
    const m = metricsFor(strategy);
    const curve = [...m.coverage.curve, m.coverage.final];
    for (const value of curve) assert.ok(value >= 0 && value <= 1, `${strategy}: ${value} in [0,1]`);
    for (let i = 1; i < curve.length; i += 1) {
      assert.ok(curve[i] >= curve[i - 1] - 1e-9, `${strategy}: coverage non-decreasing`);
    }
    for (let i = 1; i < m.coverage.per_round.length; i += 1) {
      assert.ok(m.coverage.per_round[i] >= m.coverage.per_round[i - 1] - 1e-9);
    }
  }
});

test('cellular savings is in [0,1], zero for no-coop, ordered across strategies', () => {
  const noCoop = metricsFor('no-coop');
  const replication = metricsFor('replication');
  const rarestFirst = metricsFor('rarest-first');
  for (const m of [noCoop, replication, rarestFirst]) {
    assert.ok(m.cellular.savings >= 0 && m.cellular.savings <= 1);
  }
  assert.ok(Math.abs(noCoop.cellular.savings) < 0.02, 'no-coop savings ~ 0');
  assert.ok(replication.cellular.savings >= noCoop.cellular.savings - 1e-9);
  assert.ok(rarestFirst.cellular.savings >= replication.cellular.savings - 1e-9);
});

test('geo-filter raises total-vs-full cellular savings for a cooperative strategy', () => {
  const on = metricsFor('rarest-first', true).cellular;
  const off = metricsFor('rarest-first', false).cellular;
  assert.ok(on.actual_bytes < off.actual_bytes, 'geo-on fetches fewer cellular bytes');
  assert.ok(on.total_vs_full > off.total_vs_full, 'geo-on saves more vs downloading the whole dataset');
});

test('transfer efficiency + duplicate + failure ratios sum to 1', () => {
  const m = metricsFor('replication');
  const sum = m.transfer.efficiency + m.transfer.duplicate_ratio + m.transfer.failure_ratio;
  assert.ok(Math.abs(sum - 1) < 1e-3, `ratios sum to ${sum}`);
  for (const ratio of [m.transfer.efficiency, m.transfer.duplicate_ratio, m.transfer.failure_ratio]) {
    assert.ok(ratio >= 0 && ratio <= 1);
  }
  assert.equal(m.transfer.total_p2p_bytes, m.transfer.useful_bytes + m.transfer.duplicate_bytes + m.transfer.failed_bytes);
});

test('no-coop reports no P2P transfer at all', () => {
  const m = metricsFor('no-coop');
  assert.equal(m.transfer.total_p2p_bytes, 0);
  assert.equal(m.transfer.efficiency, null);
});

test('freshness p50 <= p95 and unreached pairs are a finite count', () => {
  const m = metricsFor('rarest-first');
  assert.ok(m.freshness.applied_pairs > 0);
  assert.ok(m.freshness.p50_seconds <= m.freshness.p95_seconds);
  assert.equal(
    m.freshness.applied_pairs + m.freshness.unreached_pairs,
    m.sample_sizes.nodes * m.sample_sizes.events,
  );
  assert.ok(Number.isFinite(m.freshness.unreached_pairs));
});

test('a cooperative run reaches materially higher coverage than no-coop', () => {
  const noCoop = metricsFor('no-coop').coverage.final;
  const cooperative = metricsFor('rarest-first').coverage.final;
  assert.ok(cooperative > noCoop, `rarest-first ${cooperative} > no-coop ${noCoop}`);
});
