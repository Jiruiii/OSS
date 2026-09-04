import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { allocate, placeNodes } from '../lib/world.mjs';
import { maxPeers, roundContacts } from '../lib/topology.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'sim-config.json'), 'utf8'));

const AREAS = Object.keys(CONFIG.area_density_weights).sort();
const STUB_SCENARIO = {
  areas: AREAS,
  areaBbox: Object.fromEntries(
    AREAS.map((areaId, i) => [areaId, [121.5 + i * 0.02, 25.05 + i * 0.01, 121.51 + i * 0.02, 25.06 + i * 0.01]]),
  ),
};

const adjacentOrSame = (a, b) =>
  a === b || (CONFIG.adjacency[a] ?? []).includes(b) || (CONFIG.adjacency[b] ?? []).includes(a);

test('allocate distributes exactly `total` with stable largest-remainder', () => {
  for (const total of [10, 20, 50, 100, 7, 13]) {
    const counts = allocate(total, AREAS, CONFIG.area_density_weights);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, total);
    assert.deepEqual(allocate(total, AREAS, CONFIG.area_density_weights), counts, 'deterministic');
  }
});

test('placeNodes yields exactly N nodes with a spread of gateways', () => {
  for (const nodeCount of CONFIG.node_counts) {
    const nodes = placeNodes(STUB_SCENARIO, CONFIG, nodeCount);
    assert.equal(nodes.length, nodeCount);
    assert.deepEqual(
      nodes.map((n) => n.index),
      [...Array(nodeCount).keys()],
    );
    const gateways = nodes.filter((n) => n.isGateway);
    assert.equal(gateways.length, Math.ceil(nodeCount * CONFIG.gateway_ratio));
    const gatewayAreas = new Set(gateways.map((n) => n.areaId));
    assert.ok(gatewayAreas.size >= Math.min(AREAS.length, gateways.length), 'gateways spread across areas');
    for (const n of nodes) assert.ok(Array.isArray(n.attentionWindow) && n.attentionWindow.length === 4);
  }
});

test('placeNodes with allGateways marks every node a gateway', () => {
  const nodes = placeNodes(STUB_SCENARIO, CONFIG, 20, { allGateways: true });
  assert.ok(nodes.every((n) => n.isGateway));
});

test('roundContacts: degree <= max_peer_count <= 5, only adjacent/co-located, symmetric, seed-stable', () => {
  const nodes = placeNodes(STUB_SCENARIO, CONFIG, 50);
  const areaOf = new Map(nodes.map((n) => [n.index, n.areaId]));
  for (const seed of [1, 42, 99999]) {
    for (let round = 0; round < CONFIG.rounds; round += 1) {
      const edges = roundContacts(CONFIG, nodes, seed, round);
      const degree = new Map();
      const seen = new Set();
      for (const [a, b] of edges) {
        assert.ok(a < b, 'edges are canonical a<b');
        assert.ok(!seen.has(`${a},${b}`), 'no duplicate edge');
        seen.add(`${a},${b}`);
        assert.ok(adjacentOrSame(areaOf.get(a), areaOf.get(b)), 'edge is co-located or adjacent');
        degree.set(a, (degree.get(a) ?? 0) + 1);
        degree.set(b, (degree.get(b) ?? 0) + 1);
      }
      for (const d of degree.values()) {
        assert.ok(d <= CONFIG.max_peer_count, `degree ${d} <= max_peer_count`);
        assert.ok(d <= 5, 'degree <= 5');
      }
      assert.deepEqual(roundContacts(CONFIG, nodes, seed, round), edges, 'same seed/round reproduces');
    }
  }
});

test('roundContacts differs across seeds', () => {
  const nodes = placeNodes(STUB_SCENARIO, CONFIG, 50);
  const a = JSON.stringify(roundContacts(CONFIG, nodes, 1, 3));
  const b = JSON.stringify(roundContacts(CONFIG, nodes, 2, 3));
  assert.notEqual(a, b);
});

test('maxPeers rejects a config above the peer-summary schema cap of 5', () => {
  assert.throws(() => maxPeers({ max_peer_count: 6 }), /<= 5/);
  assert.throws(() => maxPeers({ max_peer_count: 0 }), /positive integer/);
  assert.equal(maxPeers(CONFIG), CONFIG.max_peer_count);
});
