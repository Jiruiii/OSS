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
  assert.match(limitations, /Energy Cost 未建模/);
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
