#!/usr/bin/env node

/**
 * Roll the committed run results in ../results/*.json into two flat CSVs for a
 * spreadsheet or plotting tool. No re-simulation — this only reshapes what
 * `simulator/cli.mjs matrix` already wrote.
 *
 *   node experiments/analysis/aggregate.mjs
 *
 * Writes ./coverage.csv (per-round, long format) and ./summary.csv (one row
 * per grid cell).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, '..', 'results');

function parseKey(key) {
  const parts = key.split('-');
  const geo = parts.at(-1) === 'geo';
  return {
    nodes: Number(parts[0]),
    strategy: parts.slice(1, geo ? -1 : undefined).join('-'),
    geo: geo ? 1 : 0,
  };
}

function csv(rows) {
  return `${rows.map((row) => row.join(',')).join('\n')}\n`;
}

const files = readdirSync(RESULTS_DIR)
  .filter((name) => name.endsWith('.json') && name !== 'matrix-summary.json')
  .sort();

const coverageRows = [['key', 'nodes', 'strategy', 'geo', 'round', 'seconds', 'coverage']];
const summaryRows = [
  [
    'key',
    'nodes',
    'strategy',
    'geo',
    'coverage_final',
    'coverage_relevant_final',
    'freshness_p50_s',
    'freshness_p95_s',
    'cellular_savings',
    'cellular_vs_full',
    'transfer_efficiency',
    'transfer_duplicate',
    'transfer_failure',
    'server_fetches',
  ],
];

for (const file of files) {
  const result = JSON.parse(readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
  const { nodes, strategy, geo } = parseKey(result.key);
  const spr = result.params.seconds_per_round;

  result.coverage.per_round.forEach((coverage, round) => {
    coverageRows.push([result.key, nodes, strategy, geo, round, round * spr, coverage]);
  });

  summaryRows.push([
    result.key,
    nodes,
    strategy,
    geo,
    result.coverage.final,
    result.coverage.relevant_final,
    result.freshness.p50_seconds ?? '',
    result.freshness.p95_seconds ?? '',
    result.cellular.savings,
    result.cellular.total_vs_full,
    result.transfer.efficiency ?? '',
    result.transfer.duplicate_ratio ?? '',
    result.transfer.failure_ratio ?? '',
    result.cellular.server_fetches,
  ]);
}

writeFileSync(path.join(HERE, 'coverage.csv'), csv(coverageRows), 'utf8');
writeFileSync(path.join(HERE, 'summary.csv'), csv(summaryRows), 'utf8');
console.log(JSON.stringify({ files: files.length, coverage_rows: coverageRows.length - 1, summary_rows: summaryRows.length - 1 }, null, 2));
