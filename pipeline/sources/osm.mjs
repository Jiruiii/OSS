import {
  assertRawFeatureSnapshot,
  featureBase,
  fetchStaticText,
  fieldText,
  firstValue,
  isInsideBoundary,
  normalizeId,
  normalizeTime,
  staticTimes,
} from '../lib/feature-source.mjs';
import { areaMetadataForRecord } from '../lib/coverage.mjs';

export const DEFAULT_OSM_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const DEFAULT_OSM_RELATION_ID = 2905065;
export const DEFAULT_OSM_QUERY = `[out:json][timeout:60];area(360${DEFAULT_OSM_RELATION_ID})->.neihu;(way(area.neihu)[highway];node(area.neihu)[amenity~"hospital|clinic|shelter"];way(area.neihu)[amenity~"hospital|clinic|shelter"];);out body geom;`;
export const DEFAULT_OSM_TAIWAN_QUERY = '[out:json][timeout:180];(node[amenity~"hospital|clinic|shelter"](21.8,118.0,26.5,122.2);way[amenity~"hospital|clinic|shelter"](21.8,118.0,26.5,122.2););out body geom;';

export class OsmSourceError extends Error {
  constructor(message, { code = 'OSM_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OsmSourceError';
    this.code = code;
    this.status = status;
  }
}

function osmElements(payload) {
  if (Array.isArray(payload?.elements)) return payload.elements;
  throw new OsmSourceError('OSM response must contain an elements array', { code: 'OSM_ELEMENTS_MISSING' });
}

function elementGeometry(element) {
  if (element?.geometry?.type && element.geometry.coordinates) return element.geometry;
  if (element?.type === 'node') {
    if (element.lat === undefined || element.lon === undefined) return undefined;
    return { type: 'Point', coordinates: [Number(element.lon), Number(element.lat)] };
  }
  if (Array.isArray(element?.geometry)) {
    const coordinates = element.geometry.map((position) => [Number(position.lon), Number(position.lat)]);
    return { type: 'LineString', coordinates };
  }
  if (element?.center?.lat !== undefined && element?.center?.lon !== undefined) {
    return { type: 'Point', coordinates: [Number(element.center.lon), Number(element.center.lat)] };
  }
  return undefined;
}

function osmFeatureType(tags) {
  if (tags.highway) return { layerId: 'osm-road', featureType: 'ROAD' };
  if (tags.amenity === 'hospital') return { layerId: 'osm-poi', featureType: 'HOSPITAL' };
  if (tags.amenity === 'clinic') return { layerId: 'osm-poi', featureType: 'CLINIC' };
  if (tags.amenity === 'shelter') return { layerId: 'osm-poi', featureType: 'SHELTER' };
  return { layerId: 'osm-poi', featureType: 'POI' };
}

function normalizeElement(element, index, rawSnapshot, options) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    throw new OsmSourceError(`OSM element ${index} must be an object`, { code: 'OSM_ELEMENT_INVALID' });
  }
  const tags = element.tags;
  if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) return undefined;
  const rawId = firstValue(element.id, element.osm_id);
  if (rawId === undefined) throw new OsmSourceError(`OSM element ${index} has no stable id`, { code: 'OSM_FEATURE_ID_MISSING' });
  const geometry = elementGeometry(element);
  if (!geometry) throw new OsmSourceError(`OSM element ${rawId} has no geometry`, { code: 'OSM_GEOMETRY_MISSING' });
  const inside = isInsideBoundary(geometry, options.boundary, OsmSourceError);
  if (!inside) return undefined;
  const { layerId, featureType } = osmFeatureType(tags);
  const area = areaMetadataForRecord(options, element, geometry);
  const id = normalizeId(`osm:${element.type ?? 'element'}:${rawId}`, 'OSM feature id', OsmSourceError);
  const sourceVersion = String(firstValue(
    element.timestamp,
    rawSnapshot.payload?.osm3s?.timestamp_osm_base,
    rawSnapshot.payload?.version,
    rawSnapshot.retrieved_at,
  ));
  const properties = {
    name: fieldText(tags, 'name') ?? null,
    tags: { ...tags },
    osm_type: element.type ?? null,
    osm_id: Number(rawId),
    ...area,
    ...(options.coverage ? { coverage: options.coverage } : {}),
    source_record: element,
  };
  return featureBase({
    datasetId: options.datasetId,
    layerId,
    featureId: id,
    featureType,
    geometry,
    properties,
    source: options.sourceId ?? rawSnapshot.source_id,
    sourceVersion,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    options,
    originalSource: rawSnapshot.request.url,
  });
}

export function normalizeOsmFeatures(rawSnapshot, options = {}) {
  if (!options.boundary) throw new OsmSourceError('OSM scope boundary is required for curation', { code: 'OSM_BOUNDARY_MISSING' });
  const sourceId = options.sourceId ?? rawSnapshot.source_id;
  if (!['osm-neihu', 'osm-taiwan'].includes(sourceId)) {
    throw new OsmSourceError(`OSM normalizer requires source_id=osm-neihu or osm-taiwan`, { code: 'STATIC_SOURCE_ID_INVALID' });
  }
  assertRawFeatureSnapshot(rawSnapshot, sourceId, OsmSourceError);
  const times = staticTimes(rawSnapshot, options, OsmSourceError);
  const normalizedOptions = {
    ...options,
    ...times,
    namespace: options.namespace ?? 'official.osm',
  };
  return osmElements(rawSnapshot.payload)
    .map((element, index) => normalizeElement(element, index, rawSnapshot, normalizedOptions))
    .filter(Boolean)
    .sort((left, right) => `${left.layer_id}:${left.feature_id}`.localeCompare(`${right.layer_id}:${right.feature_id}`));
}

export function fetchOsmNeihu({
  endpoint = process.env.OSM_API_ENDPOINT ?? DEFAULT_OSM_ENDPOINT,
  query = DEFAULT_OSM_QUERY,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  timeoutMs = Number(process.env.OSM_TIMEOUT_MS ?? 120000),
} = {}) {
  return fetchStaticText({
    sourceId: 'osm-neihu',
    endpoint,
    query: { data: query },
    headers: { 'User-Agent': 'ResilientGeoMesh/0.1 (Neihu data pipeline)' },
    fetchImpl,
    retrievedAt,
    timeoutMs,
    ErrorClass: OsmSourceError,
  });
}

export function fetchOsmTaiwan({
  endpoint = process.env.OSM_API_ENDPOINT ?? DEFAULT_OSM_ENDPOINT,
  query = process.env.OSM_TAIWAN_QUERY ?? DEFAULT_OSM_TAIWAN_QUERY,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  timeoutMs = Number(process.env.OSM_TIMEOUT_MS ?? 120000),
} = {}) {
  return fetchStaticText({
    sourceId: 'osm-taiwan',
    endpoint,
    query: { data: query },
    headers: { 'User-Agent': 'ResilientGeoMesh/0.1 (Taiwan data pipeline)' },
    fetchImpl,
    retrievedAt,
    timeoutMs,
    ErrorClass: OsmSourceError,
  });
}
