#!/usr/bin/env node

/**
 * One-shot Overpass fetch for the Neihu (內湖區) demo dataset.
 *
 * The output is written to fixtures/neihu/osm-snapshot.json and committed to
 * the repository. Every fixture generator reads that snapshot; nothing else in
 * the build path touches the network. Re-running this tool is only needed when
 * we deliberately want to refresh the geometry (and accept the data drift).
 *
 *   node tools/fetch-osm-neihu.mjs [--out <path>] [--endpoint <url>]
 *
 * Overpass rate-limits aggressively, so this issues exactly one query.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEFAULT_OUT = path.join(ROOT, 'fixtures', 'neihu', 'osm-snapshot.json');

// Coarse pre-filter around 內湖區. The administrative boundary polygon below is
// the authoritative extent; this box only bounds the feature scan.
const SCAN_BBOX = { south: 25.04, west: 121.54, north: 25.12, east: 121.66 };

const FEATURE_CATEGORIES = [
  { category: 'road', selector: 'way["highway"~"^(primary|secondary|tertiary)$"]' },
  { category: 'school', selector: 'nwr["amenity"="school"]' },
  { category: 'hospital', selector: 'nwr["amenity"="hospital"]' },
  { category: 'waterway', selector: 'way["waterway"="river"]' },
  { category: 'subway_station', selector: 'node["railway"="station"]["station"="subway"]' },
];

function buildQuery() {
  const { south, west, north, east } = SCAN_BBOX;
  const box = `(${south},${west},${north},${east})`;
  const featureLines = FEATURE_CATEGORIES.map(({ selector }) => `  ${selector}${box};`).join('\n');
  return [
    '[out:json][timeout:180];',
    'rel["boundary"="administrative"]["name"="內湖區"];',
    'out geom;',
    '(',
    featureLines,
    ');',
    'out geom;',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, endpoint: DEFAULT_ENDPOINT };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--out') options.out = path.resolve(argv[(index += 1)]);
    else if (item === '--endpoint') options.endpoint = argv[(index += 1)];
    else throw new Error(`unexpected argument: ${item}`);
  }
  return options;
}

function ringToGeoJson(members) {
  return members
    .filter((member) => member.type === 'way' && Array.isArray(member.geometry))
    .map((member) => member.geometry.map((point) => [point.lon, point.lat]));
}

const almostEqual = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/**
 * Assemble unordered polyline segments into closed rings. Overpass returns each
 * relation member's geometry, but not in ring order or consistent direction, so
 * we greedily chain segments by matching endpoints (reversing as needed).
 */
function assembleRings(segments) {
  const pool = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  const rings = [];
  while (pool.length > 0) {
    let ring = pool.shift();
    let extended = true;
    while (extended && !almostEqual(ring[0], ring.at(-1))) {
      extended = false;
      for (let i = 0; i < pool.length; i += 1) {
        const segment = pool[i];
        if (almostEqual(ring.at(-1), segment[0])) ring.push(...segment.slice(1));
        else if (almostEqual(ring.at(-1), segment.at(-1))) ring.push(...[...segment].reverse().slice(1));
        else if (almostEqual(ring[0], segment.at(-1))) ring = [...segment.slice(0, -1), ...ring];
        else if (almostEqual(ring[0], segment[0])) ring = [...[...segment].reverse().slice(0, -1), ...ring];
        else continue;
        pool.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4) {
      if (!almostEqual(ring[0], ring.at(-1))) ring.push([...ring[0]]);
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * Turn an Overpass administrative relation (with `out geom`) into a GeoJSON
 * Polygon/MultiPolygon.
 */
function boundaryToGeometry(relation) {
  const members = relation.members ?? [];
  const outerRings = assembleRings(ringToGeoJson(members.filter((member) => member.role !== 'inner')));
  const innerRings = assembleRings(ringToGeoJson(members.filter((member) => member.role === 'inner')));
  if (outerRings.length === 0) return null;
  if (outerRings.length === 1) {
    return { type: 'Polygon', coordinates: [outerRings[0], ...innerRings] };
  }
  return { type: 'MultiPolygon', coordinates: outerRings.map((ring) => [ring]) };
}

function geometryFromElement(element) {
  if (element.type === 'node') {
    return { type: 'Point', coordinates: [element.lon, element.lat] };
  }
  if (element.type === 'way' && Array.isArray(element.geometry)) {
    const line = element.geometry.map((point) => [point.lon, point.lat]);
    const closed =
      line.length > 3 &&
      line[0][0] === line.at(-1)[0] &&
      line[0][1] === line.at(-1)[1];
    return closed
      ? { type: 'Polygon', coordinates: [line] }
      : { type: 'LineString', coordinates: line };
  }
  if (element.type === 'relation' && Array.isArray(element.members)) {
    const geometry = boundaryToGeometry(element);
    if (geometry) return geometry;
  }
  return null;
}

function bboxOf(geometry) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of coords) visit(child);
  };
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) {
      const box = bboxOf(child);
      if (box[0] < minLon) minLon = box[0];
      if (box[1] < minLat) minLat = box[1];
      if (box[2] > maxLon) maxLon = box[2];
      if (box[3] > maxLat) maxLat = box[3];
    }
  } else {
    visit(geometry.coordinates);
  }
  return [minLon, minLat, maxLon, maxLat];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInBoundary(point, boundary) {
  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;
  return polygons.some((rings) => {
    if (!pointInRing(point, rings[0])) return false;
    return !rings.slice(1).some((hole) => pointInRing(point, hole));
  });
}

function geometryTouchesBoundary(geometry, boundary) {
  const points = [];
  const collect = (coords) => {
    if (typeof coords[0] === 'number') points.push(coords);
    else for (const child of coords) collect(child);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => collect(g.coordinates));
  else collect(geometry.coordinates);
  return points.some((point) => pointInBoundary(point, boundary));
}

const KEEP_TAGS = ['name', 'name:en', 'highway', 'amenity', 'waterway', 'railway', 'station', 'capacity', 'operator'];

function pickTags(tags = {}) {
  return Object.fromEntries(KEEP_TAGS.filter((key) => key in tags).map((key) => [key, tags[key]]));
}

function categoryOf(element) {
  const tags = element.tags ?? {};
  if (tags.amenity === 'school') return 'school';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.waterway === 'river') return 'waterway';
  if (tags.station === 'subway') return 'subway_station';
  if (['primary', 'secondary', 'tertiary'].includes(tags.highway)) return 'road';
  return 'other';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const query = buildQuery();

  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'resilientgeo-mesh/fetch-osm-neihu (https://github.com/; demo dataset build)',
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) {
    throw new Error(`Overpass returned HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  const elements = payload.elements ?? [];

  const relation = elements.find(
    (element) => element.type === 'relation' && element.tags?.boundary === 'administrative',
  );
  const boundaryGeometry = relation ? geometryFromElement(relation) : null;
  if (!boundaryGeometry) {
    throw new Error('could not build the 內湖區 administrative boundary from the Overpass response');
  }

  const features = [];
  const seen = new Set();
  for (const element of elements) {
    if (element === relation) continue;
    const key = `${element.type}/${element.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geometry = geometryFromElement(element);
    if (!geometry) continue;
    const category = categoryOf(element);
    if (category === 'other') continue;
    if (!geometryTouchesBoundary(geometry, boundaryGeometry)) continue;
    features.push({
      osm_type: element.type,
      osm_id: element.id,
      category,
      name: element.tags?.name ?? null,
      name_en: element.tags?.['name:en'] ?? null,
      tags: pickTags(element.tags),
      geometry,
      bbox: bboxOf(geometry),
    });
  }
  features.sort((a, b) => a.category.localeCompare(b.category) || a.osm_id - b.osm_id);

  const snapshot = {
    meta: {
      description: '內湖區 OSM snapshot for the ResilientGeo demo dataset. Replayable input; do not fetch live in the build path.',
      fetched_at: new Date().toISOString(),
      endpoint: options.endpoint,
      overpass_timestamp_osm_base: payload.osm3s?.timestamp_osm_base ?? null,
      scan_bbox: [SCAN_BBOX.west, SCAN_BBOX.south, SCAN_BBOX.east, SCAN_BBOX.north],
      query,
      feature_counts: features.reduce((counts, feature) => {
        counts[feature.category] = (counts[feature.category] ?? 0) + 1;
        return counts;
      }, {}),
    },
    boundary: {
      osm_type: 'relation',
      osm_id: relation.id,
      name: relation.tags?.name ?? null,
      name_en: relation.tags?.['name:en'] ?? null,
      geometry: boundaryGeometry,
      bbox: bboxOf(boundaryGeometry),
    },
    features,
  };

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      { out: options.out, boundary_bbox: snapshot.boundary.bbox, feature_counts: snapshot.meta.feature_counts },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
