#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyNcdrOperationalRelevance } from '../sources/ncdr.mjs';

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    throw new Error(`missing required option ${name}`);
  }
  return args[index + 1];
}

function coordinatePairs(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    output.push([value[0], value[1]]);
    return output;
  }
  for (const child of value) coordinatePairs(child, output);
  return output;
}

function representativePoint(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const points = coordinatePairs(geometry.coordinates);
  if (points.length === 0) return null;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return {
    type: 'Point',
    coordinates: [
      (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
      (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    ],
  };
}

function projectEvent(event) {
  const geometry = representativePoint(event.geometry);
  if (!geometry) {
    throw new Error(`event ${event.event_id ?? '<unknown>'} has no coordinates`);
  }

  const attributes = Object.fromEntries(
    Object.entries(event.attributes ?? {}).filter(
      ([key]) => key !== 'source_record',
    ),
  );
  attributes.geometry_source_type = event.geometry?.type ?? null;
  attributes.geometry_projection =
    event.geometry?.type === 'Point' ? 'source_point' : 'representative_point';
  if (event.source === 'NCDR' || event.namespace === 'official.ncdr') {
    const relevance =
      attributes.operational_relevance ??
      classifyNcdrOperationalRelevance({
        eventType: event.event_type,
        description: attributes.source_description,
        affectedArea: attributes.affected_area,
      });
    attributes.operational_relevance = relevance;
    attributes.map_visible = relevance !== 'BACKGROUND';
  }

  return {
    schema_version: 'event-v0',
    namespace: event.namespace,
    event_id: event.event_id,
    event_type: event.event_type,
    geometry,
    severity: event.severity,
    source: event.source,
    source_version: event.source_version,
    event_version: event.event_version,
    issued_at: event.issued_at,
    expires_at: event.expires_at,
    attributes,
  };
}

const inputPath = path.resolve(option('--input'));
const metadataPath = path.resolve(option('--metadata'));
const outputPath = path.resolve(option('--out'));
const batch = JSON.parse(await readFile(inputPath, 'utf8'));
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const events = (batch.events ?? []).map(projectEvent);

const output = {
  schema_version: 'event-batch-v0',
  source_id: 'ncdr-hazard-events',
  source_status: metadata.source_status ?? null,
  retrieved_at: metadata.retrieved_at ?? null,
  projection: 'flutter-demo-representative-point-v0',
  event_count: events.length,
  events,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      out: outputPath,
      source_status: output.source_status,
      retrieved_at: output.retrieved_at,
      event_count: output.event_count,
      projection: output.projection,
    },
    null,
    2,
  ),
);
