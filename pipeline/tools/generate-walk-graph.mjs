#!/usr/bin/env node
// Extracts the walkable road network the Android route engine loads
// (android/app/src/main/assets/routing/walk-roads.json) from the bundled Neihu
// OSM snapshot. The graph itself is built on the phone (routing/RoadGraph.kt);
// this only drops non-walkable classes and flattens coordinates so the asset
// stays small.
//
//   node pipeline/tools/generate-walk-graph.mjs [--input <static-features.json>] [--out <walk-roads.json>]

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// docs/superpowers/plans/2026-09-24-evacuation-routing.md「可步行道路」.
// Kept in step with RoadGraph.WALKABLE_CLASSES, which re-checks on load.
export const WALKABLE_CLASSES = [
  'footway', 'path', 'pedestrian', 'steps', 'residential', 'living_street', 'service',
  'unclassified', 'tertiary', 'secondary', 'primary', 'track', 'cycleway',
  'tertiary_link', 'secondary_link', 'primary_link',
];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputPath = option('input', path.join(ROOT, 'flutter/assets/data/neihu/static-features.json'));
const outPath = option('out', path.join(ROOT, 'android/app/src/main/assets/routing/walk-roads.json'));

const input = JSON.parse(await readFile(inputPath, 'utf8'));
const classIndex = new Map(WALKABLE_CLASSES.map((roadClass, index) => [roadClass, index]));
const ways = [];
const skipped = {};
for (const feature of input.features) {
  if (feature.kind !== 'road') continue;
  const roadClass = feature.road_class;
  if (!classIndex.has(roadClass)) {
    skipped[roadClass] = (skipped[roadClass] ?? 0) + 1;
    continue;
  }
  const lines = feature.geometry?.type === 'LineString'
    ? [feature.geometry.coordinates]
    : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
  const wayId = /^osm:way:(\d+)$/.exec(feature.id)?.[1];
  if (!wayId) continue;
  for (const line of lines) {
    if (line.length < 2) continue;
    ways.push([Number(wayId), classIndex.get(roadClass), line.flatMap(([lon, lat]) => [
      Number(lon.toFixed(7)),
      Number(lat.toFixed(7)),
    ])]);
  }
}
ways.sort((left, right) => left[0] - right[0] || left[2][0] - right[2][0]);

const contentHash = createHash('sha256').update(JSON.stringify(ways)).digest('hex').slice(0, 8);
const snapshotDate = (input.snapshot_at ?? 'unknown').slice(0, 10);
const asset = {
  schema_version: 'walk-roads-v0',
  graph_version: `${input.dataset_id ?? 'walk'}-${snapshotDate}-${contentHash}`,
  source: 'OpenStreetMap contributors (ODbL), via flutter/assets/data/neihu/static-features.json',
  snapshot_at: input.snapshot_at ?? null,
  bounds: input.bounds ?? null,
  road_classes: WALKABLE_CLASSES,
  ways,
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(asset)}\n`, 'utf8');
console.log(JSON.stringify({ out: outPath, graph_version: asset.graph_version, ways: ways.length, skipped }, null, 2));
