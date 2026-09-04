/**
 * The simulation loop.
 *
 * Per round: gateways (or everyone, under no-coop) pull a few chunks from the
 * server over cellular; then peers that met this round run DIFF / REQUEST /
 * TRANSFER / VERIFY / APPLY. Peer summaries are snapshotted at round start (the
 * HELLO a phone sends once on connect), so two peers can hand a node the same
 * missing chunk in one round — that is where duplicate transfers come from.
 */

import { getStrategy } from './strategies.mjs';
import { filterManifestEntries, filterWanted } from './geo-filter.mjs';
import { placeNodes } from './world.mjs';
import { roundContacts } from './topology.mjs';
import { applyServerChunk, transferChunk } from './transfer.mjs';
import { shuffleInPlace, subStream } from './rng.mjs';
import { computeDiff } from '../../pipeline/lib/peer-sync.mjs';

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function isoAdd(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString().replace('.000Z', 'Z');
}

function buildPeerSummary(node, scenario) {
  const chunks = [...node.heldChunks]
    .sort()
    .map((chunkId) => {
      const entry = scenario.manifestEntryById.get(chunkId);
      return {
        chunk_id: entry.chunk_id,
        chunk_hash: entry.chunk_hash,
        size_bytes: entry.size_bytes,
        priority: entry.priority,
        state: 'available',
      };
    });
  return {
    schema_version: 'peer-summary-v0',
    protocol_version: '0',
    node_id: node.id,
    generated_at: scenario.clock.issued_at,
    datasets: [
      {
        dataset_id: scenario.datasetId,
        namespace: scenario.namespace,
        manifest_id: scenario.manifest.manifest_id,
        manifest_hash: scenario.manifest.manifest_hash,
        dataset_version: scenario.manifest.dataset_version,
        chunks,
      },
    ],
  };
}

function neededEntries(scenario, node, geoFilter) {
  const missing = scenario.manifest.chunks.filter((entry) => !node.heldChunks.has(entry.chunk_id));
  return filterManifestEntries(missing, node, geoFilter);
}

/**
 * A node's server-pull order: CRITICAL first, then the rest in an order seeded
 * by the node's own identity. Different phones grabbed different parts of the
 * dataset before losing signal — that diversity is what makes the peer phase
 * able to trade anything.
 */
function serverPullOrder(entries, node, seed) {
  const shuffled = shuffleInPlace([...entries], subStream(seed, 'server-order', node.index));
  return shuffled.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

function missingAreaWideAlert(scenario, node, geoFilter) {
  return neededEntries(scenario, node, geoFilter).some((entry) => entry.theme === 'flood');
}

function globalRarity(nodes) {
  const count = new Map();
  for (const node of nodes) {
    for (const chunkId of node.heldChunks) count.set(chunkId, (count.get(chunkId) ?? 0) + 1);
  }
  return count;
}

function neighbourhoodRarity(nodes, dst, config) {
  const areas = new Set([dst.areaId, ...(config.adjacency[dst.areaId] ?? [])]);
  const count = new Map();
  for (const node of nodes) {
    if (!areas.has(node.areaId)) continue;
    for (const chunkId of node.heldChunks) count.set(chunkId, (count.get(chunkId) ?? 0) + 1);
  }
  return count;
}

function serverPhase(scenario, config, nodes, strategy, geoFilter, seed, round, simClock) {
  const pullers = strategy.usesPeerPhase
    ? nodes.filter(
        (node) =>
          node.isGateway ||
          (round >= config.cellular_fallback_rounds && missingAreaWideAlert(scenario, node, geoFilter)),
      )
    : nodes;

  for (const node of pullers) {
    const wanted = serverPullOrder(neededEntries(scenario, node, geoFilter), node, seed);
    for (const entry of wanted.slice(0, config.cellular_chunks_per_round)) {
      applyServerChunk(scenario, node, entry.chunk_id, round, simClock);
    }
  }
}

function peerPhase(scenario, config, nodes, strategy, geoFilter, seed, round, simClock, rarityScope) {
  const edges = roundContacts(config, nodes, seed, round);
  if (edges.length === 0) return;

  const summaries = nodes.map((node) => buildPeerSummary(node, scenario));
  const sharedRarity = rarityScope === 'global' ? globalRarity(nodes) : null;
  const requestCtx = {
    datasetId: scenario.datasetId,
    namespace: scenario.namespace,
    manifestId: scenario.manifest.manifest_id,
  };

  for (const [ai, bi] of edges) {
    for (const [srcIndex, dstIndex] of [
      [ai, bi],
      [bi, ai],
    ]) {
      const src = nodes[srcIndex];
      const dst = nodes[dstIndex];
      let diff;
      try {
        diff = computeDiff(summaries[dstIndex], summaries[srcIndex], {
          datasetId: scenario.datasetId,
          namespace: scenario.namespace,
        });
      } catch {
        continue;
      }
      const wanted = filterWanted(
        [...diff.missing_chunks, ...diff.stale_chunks],
        dst,
        geoFilter,
        scenario.manifestEntryById,
      );
      if (wanted.length === 0) continue;

      const rarity = sharedRarity ?? neighbourhoodRarity(nodes, dst, config);
      const orderedIds = strategy.orderRequest(wanted, { ...requestCtx, rarity });

      let budget = config.max_bytes_per_round;
      let chunkSeq = 0;
      for (const chunkId of orderedIds) {
        const size = scenario.manifestEntryById.get(chunkId).size_bytes;
        if (size > budget) break;
        budget -= size;
        transferChunk(scenario, config, src, dst, chunkId, seed, round, chunkSeq, simClock);
        chunkSeq += 1;
      }
    }
  }
}

export function runSimulation(options) {
  const {
    scenario,
    config,
    nodeCount,
    strategy: strategyName,
    seed,
    geoFilter = false,
    rounds = config.rounds,
    secondsPerRound = config.seconds_per_round,
    rarityScope = config.rarity_scope ?? 'global',
  } = options;

  const strategy = getStrategy(strategyName);
  const nodes = placeNodes(scenario, config, nodeCount, { allGateways: strategy.allGateways });

  for (let round = 0; round < rounds; round += 1) {
    const simClock = isoAdd(scenario.clock.issued_at, round * secondsPerRound);
    serverPhase(scenario, config, nodes, strategy, geoFilter, seed, round, simClock);
    if (strategy.usesPeerPhase) {
      peerPhase(scenario, config, nodes, strategy, geoFilter, seed, round, simClock, rarityScope);
    }
  }

  return {
    nodes,
    params: {
      scenario_id: config.scenario_id,
      node_count: nodeCount,
      strategy: strategyName,
      geo_filter: geoFilter,
      seed,
      rounds,
      seconds_per_round: secondsPerRound,
      rarity_scope: rarityScope,
    },
  };
}
