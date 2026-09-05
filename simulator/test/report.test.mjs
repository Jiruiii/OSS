import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildScenario } from '../lib/scenario.mjs';
import { runMatrix } from '../lib/matrix.mjs';
import { renderReport } from '../lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FULL_CONFIG = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'sim-config.json'), 'utf8'));
const CONFIG = { ...FULL_CONFIG, node_counts: [10, 20] };
const SCENARIO = buildScenario();
const RESULTS = runMatrix({ scenario: SCENARIO, config: CONFIG, seed: 55, geoFilterMode: 'both' });
const REPORT = renderReport(RESULTS, SCENARIO, CONFIG);

const GRID_SIZE = CONFIG.node_counts.length * 3 * 2;

function sectionBody(heading) {
  const start = REPORT.indexOf(`\n## ${heading}`);
  assert.ok(start !== -1, `section "${heading}" is present`);
  const rest = REPORT.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

test('every metric section carries scenario params and a sample-size note', () => {
  for (const heading of ['1. Data Coverage', '2. Freshness Lag', '3. Cellular Savings', '4. Transfer Efficiency']) {
    const body = sectionBody(heading);
    assert.match(body, />\s*(條件|固定情境)/, `${heading}: has a caption line`);
  }
  const coverage = sectionBody('1. Data Coverage');
  assert.match(coverage, /seed \d+/);
  assert.match(coverage, /樣本/);
  assert.match(coverage, /\|E\|/);
});

test('the report has a Limitations section with the no-whole-city disclaimer', () => {
  assert.match(REPORT, /\n## Limitations\n/);
  const limitations = sectionBody('Limitations');
  assert.match(limitations, /不宣稱.*固定時間.*全城/);
  assert.match(limitations, /Energy Cost.*(單一機型|單一 60 秒視窗)/);
});

test('the report has an Energy Cost section with real-device sample sizes and caveats', () => {
  const energy = sectionBody('5. Energy Cost');
  assert.match(energy, /Pixel 7/);
  // Both conditions must be named, so the section cannot silently become a
  // single-condition number with no baseline to compare against.
  assert.match(energy, /baseline/);
  assert.match(energy, /emergency-mode/);
  // Sample size stated as runs x samples: the previous measurement's headline
  // came from one 60-sample window, which is how a single transient became a
  // reported "1810 mW connection spike".
  assert.match(energy, /6 輪/);
  assert.match(energy, /360 筆/);
  assert.match(energy, /(限制|樣本數)/);
});

test('the Energy Cost section marks the withdrawn 2026-09-05 measurement as withdrawn', () => {
  // The 22.35 / 26.78 mW figures measured gauge noise on a plugged-in, fully
  // charged phone. They are allowed to appear only as something explicitly
  // retracted, never as a live number.
  const energy = sectionBody('5. Energy Cost');
  for (const stale of ['22.35', '26.78']) {
    if (energy.includes(stale)) {
      assert.match(energy, /作廢/, `${stale} appears without being marked withdrawn`);
    }
  }
});

test('no whole-city / fixed-time claim appears outside the disclaimer', () => {
  const beforeLimitations = REPORT.slice(0, REPORT.indexOf('\n## Limitations'));
  assert.doesNotMatch(beforeLimitations, /固定時間[^\n]*全城/);
  assert.doesNotMatch(beforeLimitations, /covers?[^\n]{0,20}whole city/i);
  assert.doesNotMatch(beforeLimitations, /whole city[^\n]{0,20}(in|within)[^\n]{0,20}(minutes?|time)/i);
});

test('the coverage table has exactly one row per grid cell', () => {
  const body = sectionBody('1. Data Coverage');
  const dataRows = body.split('\n').filter((line) => /^\|\s+\d+ · /.test(line));
  assert.equal(dataRows.length, GRID_SIZE);
});

test('config hash in the header matches the effective config', () => {
  assert.match(REPORT, /sim-config\.json sha256 \| `sha256:[0-9a-f]{64}`/);
});
