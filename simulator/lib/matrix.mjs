/**
 * Run the full experiment grid: node counts × strategies × geo-filter.
 * The result list feeds both the report and `matrix --check`.
 */

import { runSimulation } from './engine.mjs';
import { computeMetrics } from './metrics.mjs';
import { STRATEGY_NAMES } from './strategies.mjs';

export function runKey(nodeCount, strategy, geoFilter) {
  return `${nodeCount}-${strategy}${geoFilter ? '-geo' : ''}`;
}

function geoOptionsFor(mode) {
  if (mode === 'on') return [true];
  if (mode === 'off') return [false];
  return [false, true];
}

export function runMatrix({ scenario, config, seed, geoFilterMode = 'both', rarityScope }) {
  const results = [];
  for (const nodeCount of config.node_counts) {
    for (const strategy of STRATEGY_NAMES) {
      for (const geoFilter of geoOptionsFor(geoFilterMode)) {
        const run = runSimulation({ scenario, config, nodeCount, strategy, seed, geoFilter, rarityScope });
        const metrics = computeMetrics(run, scenario, config);
        results.push({ key: runKey(nodeCount, strategy, geoFilter), ...metrics });
      }
    }
  }
  return results;
}
