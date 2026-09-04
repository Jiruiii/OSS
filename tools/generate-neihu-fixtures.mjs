#!/usr/bin/env node

/**
 * Generate the Neihu demo fixtures from the committed OSM snapshot and the
 * scenario script. Nothing here touches the network.
 *
 *   node tools/generate-neihu-fixtures.mjs [--check]
 *
 * Outputs (TDX-shaped source files consumed by `pipeline/cli.mjs build`):
 *   fixtures/neihu/demo-v136.json   ~30 curated events, 5 areas x 6 themes
 *   fixtures/neihu/demo-v137.json   the v137 delta of demo-v136
 *   fixtures/neihu/scale-v136.json  ~500 events for multi-chunk + simulation
 *
 * Real OSM geometry, synthetic incident content. The generator is fully
 * deterministic: a fixed seed produces byte-identical output. `--check` writes
 * to a temp dir and fails if it differs from the committed files.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NEIHU_DIR = path.join(ROOT, 'fixtures', 'neihu');

const SEVERITY_BY_INDEX = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CATEGORY_THEME = {
  road: 'road',
  school: 'shelter',
  hospital: 'medical',
  subway_station: 'transit',
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function representativePoint(geometry) {
  const points = [];
  const collect = (coords) => {
    if (typeof coords[0] === 'number') points.push(coords);
    else for (const child of coords) collect(child);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => collect(g.coordinates));
  else collect(geometry.coordinates);
  const sum = points.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function distanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function nearestArea(point, areas) {
  let best = null;
  let bestDistance = Infinity;
  for (const [areaId, area] of Object.entries(areas)) {
    const distance = distanceSquared(point, area.seed);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = areaId;
    }
  }
  return best;
}

function shortId(feature) {
  const base = feature.name_en || feature.name || `${feature.osm_type}${feature.osm_id}`;
  return `${feature.osm_type[0]}${feature.osm_id}-${base}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function roadStatusRecord(feature, areaId, theme, themes, rng) {
  const status = rng() < 0.25 ? (rng() < 0.5 ? 'CLOSED' : 'PARTIAL') : 'OPEN';
  return {
    baseId: shortId(feature),
    theme,
    namespace: themes[theme].namespace,
    source: themes[theme].source,
    event_type: themes[theme].event_type,
    area_id: areaId,
    geometry: feature.geometry,
    severity: status === 'CLOSED' ? 'CRITICAL' : status === 'PARTIAL' ? 'HIGH' : 'LOW',
    properties: statusProperties(theme, feature, status, rng),
  };
}

function statusProperties(theme, feature, status, rng) {
  const name = feature.name ?? null;
  if (theme === 'road') return { status, road_name: name, reason: status === 'OPEN' ? null : 'accumulated water / debris' };
  if (theme === 'shelter') {
    const capacity = 120 + Math.floor(rng() * 40) * 10;
    return { status: status === 'CLOSED' ? 'STANDBY' : 'OPEN', site_name: name, capacity, available: Math.floor(capacity * rng()) };
  }
  if (theme === 'medical') return { status: status === 'CLOSED' ? 'DIVERT' : 'NORMAL', facility_name: name, emergency_dept: true };
  if (theme === 'transit') return { status: status === 'CLOSED' ? 'SUSPENDED' : 'NORMAL', line: '文湖線', station: name };
  if (theme === 'flood') return { status: 'ACTIVE', alert_type: 'RIVERBANK_FLOOD', river: name ?? '基隆河' };
  if (theme === 'landslide') return { status: 'WATCH', hillside_road: name, trigger: 'sustained rainfall' };
  return { status };
}

function syntheticFloodGeometry(waterway) {
  const line = waterway.geometry.type === 'LineString' ? waterway.geometry.coordinates : [representativePoint(waterway.geometry)];
  const mid = line[Math.floor(line.length / 2)];
  const d = 0.0016;
  return {
    type: 'Polygon',
    coordinates: [[
      [round6(mid[0] - d), round6(mid[1] - d)],
      [round6(mid[0] + d), round6(mid[1] - d)],
      [round6(mid[0] + d), round6(mid[1] + d)],
      [round6(mid[0] - d), round6(mid[1] + d)],
      [round6(mid[0] - d), round6(mid[1] - d)],
    ]],
  };
}

function round6(value) {
  return Number(value.toFixed(6));
}

const HILLSIDE_ROAD_NAMES = ['碧山路', '環山路一段', '環山路二段', '環山路三段', '金龍路', '康樂街', '大湖山莊街', '康湖路'];

function hillsideRoads(features) {
  return features.filter((feature) => feature.category === 'road' && HILLSIDE_ROAD_NAMES.includes(feature.name));
}

function buildRecords(snapshot, scenario, { versionOf, rng }) {
  const areas = scenario.areas;
  const themes = scenario.themes;
  const records = [];

  const assigned = snapshot.features
    .filter((feature) => CATEGORY_THEME[feature.category])
    .map((feature) => {
      const theme = CATEGORY_THEME[feature.category];
      const areaId = nearestArea(representativePoint(feature.geometry), areas);
      return { feature, theme, areaId };
    });

  for (const { feature, theme, areaId } of assigned) {
    const record = roadStatusRecord(feature, areaId, theme, themes, rng);
    records.push(record);
  }

  // Synthetic hazard events: one flood polygon per flood-hazard area drawn from a
  // nearby river segment, one landslide line per landslide-hazard area from a
  // hillside road. Deterministic pick: closest feature to the area seed.
  const waterways = snapshot.features.filter((feature) => feature.category === 'waterway');
  const hillsides = hillsideRoads(snapshot.features);
  for (const [areaId, area] of Object.entries(areas)) {
    for (const hazard of area.hazards) {
      const pool = hazard === 'flood' ? waterways : hillsides;
      if (pool.length === 0) continue;
      const near = [...pool].sort(
        (a, b) =>
          distanceSquared(representativePoint(a.geometry), area.seed) -
          distanceSquared(representativePoint(b.geometry), area.seed),
      )[0];
      const geometry = hazard === 'flood' ? syntheticFloodGeometry(near) : near.geometry;
      records.push({
        baseId: `${areaId.split('.').pop()}-${hazard}`,
        theme: hazard,
        namespace: themes[hazard].namespace,
        source: themes[hazard].source,
        event_type: themes[hazard].event_type,
        area_id: areaId,
        geometry,
        severity: hazard === 'flood' ? 'CRITICAL' : 'HIGH',
        properties: statusProperties(hazard, near, 'ACTIVE', rng),
      });
    }
  }

  return records.map((record, index) => {
    const version = versionOf(record, index, rng);
    return {
      id: record.baseId,
      event_id: `${record.theme}:${record.baseId}`,
      namespace: record.namespace,
      source: record.source,
      event_type: record.event_type,
      event_version: version,
      area_id: record.area_id,
      theme: record.theme,
      geometry: record.geometry,
      severity: record.severity,
      properties: record.properties,
    };
  });
}

function wrap(records, { datasetVersion, sourceVersion, clock, seed, snapshot }) {
  return {
    source: 'OSM_SYNTHETIC',
    source_version: String(sourceVersion),
    dataset_id: 'resilientgeo-demo',
    dataset_version: datasetVersion,
    retrieved_at: clock.retrieved_at,
    issued_at: clock.issued_at,
    expires_at: clock.expires_at,
    generator: {
      tool: 'tools/generate-neihu-fixtures.mjs',
      seed,
      snapshot_fetched_at: snapshot.meta.fetched_at,
      note: 'Real 內湖區 OSM geometry, synthetic incident content. Not a real disaster feed.',
    },
    records: records.map((record) => ({
      ...record,
      issued_at: clock.issued_at,
      expires_at: clock.expires_at,
    })),
  };
}

function curatedSubset(records, scenario) {
  const limits = scenario.curated.per_area;
  const counters = new Map();
  const kept = [];
  for (const record of records) {
    const key = `${record.area_id} ${record.theme}`;
    const used = counters.get(key) ?? 0;
    const limit = limits[record.theme] ?? scenario.curated.hazard_per_area;
    if (used >= limit) continue;
    counters.set(key, used + 1);
    kept.push(record);
  }
  return kept;
}

async function generate(snapshot, scenario) {
  const clock = scenario.clock;

  const curatedRng = mulberry32(0x0c0ffee1);
  const curatedAll = buildRecords(snapshot, scenario, {
    rng: curatedRng,
    versionOf: () => 1,
  });
  const curated = curatedSubset(curatedAll, scenario);
  const demoV136 = wrap(curated, {
    datasetVersion: 136,
    sourceVersion: 136,
    seed: 'curated',
    snapshot,
    clock: { retrieved_at: clock.retrieved_at, issued_at: clock.issued_at, expires_at: clock.v136_expires_at },
  });

  const bumpRng = mulberry32(0x0c0ffee2);
  const bumpRatio = scenario.curated.v137.version_bump_ratio;
  const v137Records = curated.map((record) => {
    if (bumpRng() >= bumpRatio) return record;
    const bumped = { ...record, event_version: record.event_version + 1 };
    bumped.properties = { ...record.properties, status: escalate(record.properties.status) };
    bumped.severity = escalateSeverity(record.severity);
    return bumped;
  });
  for (let i = 0; i < scenario.curated.v137.new_events; i += 1) {
    const donor = curatedAll[(i + 1) * 7 % curatedAll.length];
    v137Records.push({ ...donor, id: `${donor.id}-v137-${i}`, event_id: `${donor.theme}:${donor.id}-v137-${i}`, event_version: 1 });
  }
  const demoV137 = wrap(v137Records, {
    datasetVersion: 137,
    sourceVersion: 137,
    seed: 'curated',
    snapshot,
    clock: { retrieved_at: clock.v137_retrieved_at, issued_at: clock.v137_issued_at, expires_at: clock.v137_expires_at },
  });

  const scaleRng = mulberry32(scenario.scale.seed);
  const maxVersion = scenario.scale.max_event_version;
  const scaleRatio = scenario.scale.version_bump_ratio;
  let scaleRecords = buildRecords(snapshot, scenario, {
    rng: scaleRng,
    versionOf: () => {
      if (scaleRng() >= scaleRatio) return 1;
      return 1 + Math.floor(scaleRng() * maxVersion);
    },
  });
  scaleRecords = padToTarget(scaleRecords, snapshot, scenario, scaleRng);
  const scaleV136 = wrap(scaleRecords, {
    datasetVersion: 136,
    sourceVersion: 136,
    seed: scenario.scale.seed,
    snapshot,
    clock: { retrieved_at: clock.retrieved_at, issued_at: clock.issued_at, expires_at: clock.v136_expires_at },
  });

  return {
    'demo-v136.json': demoV136,
    'demo-v137.json': demoV137,
    'scale-v136.json': scaleV136,
  };
}

function escalate(status) {
  const ladder = {
    OPEN: 'PARTIAL',
    PARTIAL: 'CLOSED',
    NORMAL: 'DIVERT',
    STANDBY: 'OPEN',
    WATCH: 'ALERT',
    ACTIVE: 'ACTIVE',
  };
  return ladder[status] ?? status;
}

function escalateSeverity(severity) {
  const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return order[Math.min(order.length - 1, order.indexOf(severity) + 1)];
}

function padToTarget(records, snapshot, scenario, rng) {
  const target = scenario.scale.target_event_count;
  if (records.length >= target) return records.slice(0, target);
  const waterways = snapshot.features.filter((feature) => feature.category === 'waterway');
  const areaIds = Object.keys(scenario.areas);
  const padded = [...records];
  let i = 0;
  while (padded.length < target) {
    const areaId = areaIds[i % areaIds.length];
    const hazard = scenario.areas[areaId].hazards[0];
    const donor = waterways[i % waterways.length];
    const theme = scenario.themes[hazard];
    padded.push({
      id: `${areaId.split('.').pop()}-${hazard}-${i}`,
      event_id: `${hazard}:${areaId.split('.').pop()}-${hazard}-${i}`,
      namespace: theme.namespace,
      source: theme.source,
      event_type: theme.event_type,
      event_version: rng() < 0.15 ? 2 : 1,
      area_id: areaId,
      theme: hazard,
      geometry: hazard === 'flood' ? syntheticFloodGeometry(donor) : donor.geometry,
      severity: SEVERITY_BY_INDEX[Math.floor(rng() * 4)],
      properties: statusProperties(hazard, donor, 'ACTIVE', rng),
    });
    i += 1;
  }
  return padded;
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const snapshot = JSON.parse(await readFile(path.join(NEIHU_DIR, 'osm-snapshot.json'), 'utf8'));
  const scenario = JSON.parse(await readFile(path.join(NEIHU_DIR, 'scenario.json'), 'utf8'));
  const outputs = await generate(snapshot, scenario);

  if (check) {
    let mismatch = false;
    for (const [name, value] of Object.entries(outputs)) {
      const expected = await readFile(path.join(NEIHU_DIR, name), 'utf8').catch(() => null);
      if (expected !== stableStringify(value)) {
        mismatch = true;
        console.error(`MISMATCH: fixtures/neihu/${name} is stale; re-run without --check`);
      }
    }
    if (mismatch) process.exitCode = 1;
    else console.log('PASS: committed Neihu fixtures match a fresh deterministic generation');
    return;
  }

  await mkdir(NEIHU_DIR, { recursive: true });
  const summary = {};
  for (const [name, value] of Object.entries(outputs)) {
    await writeFile(path.join(NEIHU_DIR, name), stableStringify(value), 'utf8');
    summary[name] = value.records.length;
  }
  console.log(JSON.stringify({ out: NEIHU_DIR, event_counts: summary }, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
