import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildScenario } from '../lib/scenario.mjs';
import { runMatrix } from '../lib/matrix.mjs';
import { canonicalRun } from '../lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CLI = path.join(ROOT, 'simulator', 'cli.mjs');
const FULL_CONFIG = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'sim-config.json'), 'utf8'));
// A trimmed grid keeps this suite fast; the full 24-cell grid is exercised by
// `npm run sim:check` and the check test.
const CONFIG = { ...FULL_CONFIG, node_counts: [10, 20] };

test('runMatrix is byte-identical across two builds with the same seed', () => {
  const a = runMatrix({ scenario: buildScenario(), config: CONFIG, seed: 777, geoFilterMode: 'both' });
  const b = runMatrix({ scenario: buildScenario(), config: CONFIG, seed: 777, geoFilterMode: 'both' });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].key, b[i].key);
    assert.equal(canonicalRun(a[i]), canonicalRun(b[i]), `${a[i].key} differs`);
  }
});

test('a different seed produces different metrics', () => {
  const a = runMatrix({ scenario: buildScenario(), config: CONFIG, seed: 1, geoFilterMode: 'off' });
  const b = runMatrix({ scenario: buildScenario(), config: CONFIG, seed: 2, geoFilterMode: 'off' });
  const changed = a.some((run, i) => canonicalRun(run) !== canonicalRun(b[i]));
  assert.ok(changed, 'at least one run should differ across seeds');
});

test('the run command writes byte-identical output across two processes', () => {
  const dirA = mkdtempSync(path.join(tmpdir(), 'sim-a-'));
  const dirB = mkdtempSync(path.join(tmpdir(), 'sim-b-'));
  try {
    const args = ['run', '--nodes', '20', '--strategy', 'rarest-first', '--seed', '42', '--geo-filter', '--out'];
    execFileSync('node', [CLI, ...args, dirA], { stdio: 'pipe' });
    execFileSync('node', [CLI, ...args, dirB], { stdio: 'pipe' });
    const stripRev = (dir) => {
      const parsed = JSON.parse(readFileSync(path.join(dir, '20-rarest-first-geo.json'), 'utf8'));
      delete parsed.git_rev;
      return JSON.stringify(parsed);
    };
    assert.equal(stripRev(dirA), stripRev(dirB));
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
