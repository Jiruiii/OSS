/**
 * Turn a finished simulation into the four reported metrics.
 *
 * Everything is derived from `node.appliedRound` (the first round a node held an
 * identity at its latest version) and the per-node byte counters. The default
 * grid issues every event at round 0, so `appliedRound` is set once and
 * coverage is cleanly monotonic.
 */

import { isRelevant } from './geo-filter.mjs';

function nearestRankPercentile(sortedValues, q) {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((q / 100) * sortedValues.length);
  return sortedValues[Math.max(0, rank - 1)];
}

function relevantIdentities(node, scenario) {
  const set = new Set();
  for (const identity of scenario.eventIdentities) {
    const chunkId = scenario.chunkIdByEventIdentity.get(identity);
    const entry = scenario.manifestEntryById.get(chunkId);
    if (isRelevant(entry, node)) set.add(identity);
  }
  return set;
}

export function computeMetrics(run, scenario, config) {
  const { nodes, params } = run;
  const nodeCount = nodes.length;
  const identities = scenario.eventIdentities;
  const eventCount = identities.length;
  const rounds = params.rounds;
  const secondsPerRound = params.seconds_per_round;
  const tMinutes = [1, 3, 5, 10];
  const roundAt = (t) => Math.round((t * 60) / secondsPerRound);

  const heldBy = (node, rho) => {
    let held = 0;
    for (const appliedRound of node.appliedRound.values()) if (appliedRound <= rho) held += 1;
    return held;
  };

  const coverageAt = (rho) => {
    let sum = 0;
    for (const node of nodes) sum += heldBy(node, rho) / eventCount;
    return sum / nodeCount;
  };
  const strictCoverageAt = (rho) => {
    let full = 0;
    for (const node of nodes) if (heldBy(node, rho) === eventCount) full += 1;
    return full / nodeCount;
  };

  const relevantSets = nodes.map((node) =>
    params.geo_filter ? relevantIdentities(node, scenario) : null,
  );
  const relevantCoverageAt = (rho) => {
    let sum = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const relevant = relevantSets[i];
      if (!relevant) {
        sum += heldBy(nodes[i], rho) / eventCount;
        continue;
      }
      let held = 0;
      for (const identity of relevant) {
        const appliedRound = nodes[i].appliedRound.get(identity);
        if (appliedRound !== undefined && appliedRound <= rho) held += 1;
      }
      sum += relevant.size === 0 ? 1 : held / relevant.size;
    }
    return sum / nodeCount;
  };

  const roundsAtT = tMinutes.map(roundAt);
  const perRound = [];
  for (let r = 0; r < rounds; r += 1) perRound.push(round4(coverageAt(r)));

  const coverage = {
    t_minutes: tMinutes,
    rounds_at_t: roundsAtT,
    curve: roundsAtT.map((rho) => round4(coverageAt(rho))),
    final: round4(coverageAt(rounds - 1)),
    strict_curve: roundsAtT.map((rho) => round4(strictCoverageAt(rho))),
    strict_final: round4(strictCoverageAt(rounds - 1)),
    relevant_curve: roundsAtT.map((rho) => round4(relevantCoverageAt(rho))),
    relevant_final: round4(relevantCoverageAt(rounds - 1)),
    per_round: perRound,
    sample_event_holdings: nodeCount * eventCount,
  };

  const lags = [];
  let unreachedPairs = 0;
  for (const node of nodes) {
    for (const identity of identities) {
      const appliedRound = node.appliedRound.get(identity);
      if (appliedRound === undefined) unreachedPairs += 1;
      else lags.push(appliedRound * secondsPerRound);
    }
  }
  lags.sort((a, b) => a - b);
  const p50 = nearestRankPercentile(lags, 50);
  const p95 = nearestRankPercentile(lags, 95);
  const freshness = {
    p50_seconds: p50,
    p95_seconds: p95,
    p50_minutes: p50 === null ? null : round2(p50 / 60),
    p95_minutes: p95 === null ? null : round2(p95 / 60),
    applied_pairs: lags.length,
    unreached_pairs: unreachedPairs,
  };

  const sizeOf = (chunkId) => scenario.manifestEntryById.get(chunkId).size_bytes;
  const wholeDatasetBytes = scenario.manifest.chunks.reduce((s, entry) => s + entry.size_bytes, 0);

  // baseline = every byte a node now holds, as if it had all come from the
  // server. So no-coop (every held chunk was a server pull) lands at 0 savings,
  // and a cooperative node that assembled the same data over P2P lands high.
  const baselineBytes = nodes.reduce(
    (sum, node) => sum + [...node.heldChunks].reduce((s, id) => s + sizeOf(id), 0),
    0,
  );
  const actualBytes = nodes.reduce((s, n) => s + n.cellularBytes, 0);
  const cellular = {
    baseline_bytes: baselineBytes,
    actual_bytes: actualBytes,
    savings: baselineBytes === 0 ? 0 : round4(clamp01(1 - actualBytes / baselineBytes)),
    bytes_saved: baselineBytes - actualBytes,
    // vs every node independently downloading the ENTIRE dataset; geo-filter
    // shows up here because it shrinks what a node ever needs to hold.
    baseline_full_bytes: nodeCount * wholeDatasetBytes,
    total_vs_full: round4(clamp01(1 - actualBytes / (nodeCount * wholeDatasetBytes))),
    server_fetches: nodes.reduce((s, n) => s + n.cellularFetches, 0),
  };

  const usefulBytes = nodes.reduce((s, n) => s + n.usefulRxBytes, 0);
  const duplicateBytes = nodes.reduce((s, n) => s + n.duplicateRxBytes, 0);
  const failedBytes = nodes.reduce((s, n) => s + n.failedRxBytes, 0);
  const totalP2P = usefulBytes + duplicateBytes + failedBytes;
  const transfer = {
    efficiency: totalP2P === 0 ? null : round4(usefulBytes / totalP2P),
    duplicate_ratio: totalP2P === 0 ? null : round4(duplicateBytes / totalP2P),
    failure_ratio: totalP2P === 0 ? null : round4(failedBytes / totalP2P),
    useful_bytes: usefulBytes,
    duplicate_bytes: duplicateBytes,
    failed_bytes: failedBytes,
    useful_event_bytes: nodes.reduce((s, n) => s + n.usefulEventBytes, 0),
    total_p2p_bytes: totalP2P,
    transfers: nodes.reduce((s, n) => s + n.p2pTransfersOk, 0),
    failed_transfers: nodes.reduce((s, n) => s + n.p2pTransfersFailed, 0),
  };

  return {
    params,
    sample_sizes: {
      nodes: nodeCount,
      events: eventCount,
      event_holdings: nodeCount * eventCount,
      freshness_pairs: lags.length,
    },
    coverage,
    freshness,
    cellular,
    transfer,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
function round4(value) {
  return value === null ? null : Math.round(value * 10000) / 10000;
}
