/**
 * Deterministic round-based contact graph.
 *
 * Each node proposes up to `min(max_peer_count, 5)` peers drawn from its own
 * area and adjacent areas (schema caps a peer summary's max_peer_count at 5).
 * Each proposed edge is realized with `contact_probability`. Finally a hard
 * degree cap is applied in sorted edge order so no node exceeds max_peer_count
 * even when many neighbours chose it.
 */

import { shuffleInPlace, subStream } from './rng.mjs';

export function maxPeers(config) {
  if (!Number.isInteger(config.max_peer_count) || config.max_peer_count < 1) {
    throw new RangeError('max_peer_count must be a positive integer');
  }
  if (config.max_peer_count > 5) {
    throw new RangeError('max_peer_count must be <= 5 (peer-summary-v0 schema)');
  }
  return config.max_peer_count;
}

export function roundContacts(config, nodes, masterSeed, round) {
  const cap = maxPeers(config);

  const nodesByArea = new Map();
  for (const node of nodes) {
    if (!nodesByArea.has(node.areaId)) nodesByArea.set(node.areaId, []);
    nodesByArea.get(node.areaId).push(node.index);
  }

  const proposed = new Set();
  for (const node of nodes) {
    const areasToScan = [node.areaId, ...(config.adjacency[node.areaId] ?? [])];
    const candidates = [];
    for (const areaId of areasToScan) {
      for (const other of nodesByArea.get(areaId) ?? []) {
        if (other !== node.index) candidates.push(other);
      }
    }
    candidates.sort((a, b) => a - b);
    shuffleInPlace(candidates, subStream(masterSeed, 'contacts', round, node.index));

    for (const other of candidates.slice(0, cap)) {
      const a = Math.min(node.index, other);
      const b = Math.max(node.index, other);
      if (subStream(masterSeed, 'edge', round, a, b)() < config.contact_probability) {
        proposed.add(`${a},${b}`);
      }
    }
  }

  const sortedEdges = [...proposed]
    .map((key) => key.split(',').map(Number))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const degree = new Map();
  const edges = [];
  for (const [a, b] of sortedEdges) {
    if ((degree.get(a) ?? 0) >= cap || (degree.get(b) ?? 0) >= cap) continue;
    edges.push([a, b]);
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  return edges;
}
