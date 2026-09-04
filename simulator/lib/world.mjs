/**
 * Node model + deterministic placement.
 *
 * `placeNodes` takes primitives (`areas`, `areaBbox`, config) rather than the
 * whole ScenarioContext so the topology tests can build a world without paying
 * for a full signed bundle.
 */

function nodeId(index) {
  return `sim-node-${String(index + 1).padStart(3, '0')}`;
}

export function createNode(index, areaId, attentionWindow, areaSet, isGateway) {
  return {
    id: nodeId(index),
    index,
    areaId,
    attentionWindow,
    areaSet,
    isGateway,
    store: new Map(),
    heldChunks: new Set(),
    appliedRound: new Map(),
    cellularBytes: 0,
    cellularFetches: 0,
    p2pRxBytes: 0,
    usefulRxBytes: 0,
    usefulEventBytes: 0,
    duplicateRxBytes: 0,
    failedRxBytes: 0,
    chunksVerified: 0,
    p2pTransfersOk: 0,
    p2pTransfersFailed: 0,
  };
}

/**
 * Largest-remainder allocation of `total` across `keys` by `weights`, ties
 * broken by key string order so the result is stable.
 */
export function allocate(total, keys, weights) {
  const sortedKeys = [...keys].sort();
  const weightSum = sortedKeys.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (weightSum <= 0) throw new RangeError('area_density_weights must sum to a positive number');

  const exact = sortedKeys.map((key) => (total * (weights[key] ?? 0)) / weightSum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);

  const order = sortedKeys
    .map((key, i) => ({ key, i, frac: exact[i] - floors[i] }))
    .sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : 1));

  const counts = {};
  sortedKeys.forEach((key, i) => {
    counts[key] = floors[i];
  });
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    counts[order[k].key] += 1;
    remainder -= 1;
  }
  return counts;
}

function attentionWindow(areaId, areaBbox, adjacency) {
  let box = areaBbox[areaId] ? [...areaBbox[areaId]] : null;
  for (const neighbour of adjacency[areaId] ?? []) {
    const neighbourBox = areaBbox[neighbour];
    if (!neighbourBox) continue;
    box = box
      ? [
          Math.min(box[0], neighbourBox[0]),
          Math.min(box[1], neighbourBox[1]),
          Math.max(box[2], neighbourBox[2]),
          Math.max(box[3], neighbourBox[3]),
        ]
      : [...neighbourBox];
  }
  return box;
}

/**
 * Deterministically place `nodeCount` nodes across the areas, then pick
 * gateways round-robin across areas by node index (so every populated area gets
 * one before any area gets two). `allGateways` forces the no-coop model where
 * every node has its own cellular link.
 */
export function placeNodes(scenario, config, nodeCount, { allGateways = false } = {}) {
  const areas = [...scenario.areas].sort();
  const counts = allocate(nodeCount, areas, config.area_density_weights);

  const nodes = [];
  let index = 0;
  for (const areaId of areas) {
    const window = attentionWindow(areaId, scenario.areaBbox, config.adjacency);
    const areaSet = new Set([areaId, ...(config.adjacency[areaId] ?? [])]);
    for (let k = 0; k < counts[areaId]; k += 1) {
      nodes.push(createNode(index, areaId, window, areaSet, allGateways));
      index += 1;
    }
  }

  if (allGateways) return nodes;

  const quota = Math.min(nodes.length, Math.max(1, Math.ceil(nodeCount * config.gateway_ratio)));
  const byArea = new Map(areas.map((areaId) => [areaId, nodes.filter((n) => n.areaId === areaId)]));
  let assigned = 0;
  let progressed = true;
  while (assigned < quota && progressed) {
    progressed = false;
    for (const areaId of areas) {
      if (assigned >= quota) break;
      const next = byArea.get(areaId).find((n) => !n.isGateway);
      if (!next) continue;
      next.isGateway = true;
      assigned += 1;
      progressed = true;
    }
  }
  return nodes;
}
