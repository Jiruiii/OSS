import {
  isGeometryInNeihu,
  normalizeCoordinate,
} from '../lib/geo.mjs';
import {
  makeRawSnapshot,
  requestJson,
  validateRawSnapshot,
} from '../lib/source.mjs';

// NCDR's authenticated alert datastore path is configurable because the
// concrete dataset route is assigned during API onboarding.
export const DEFAULT_NCDR_ENDPOINT = 'https://alerts.ncdr.nat.gov.tw/api/datastore';

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export class NcdrCredentialError extends Error {
  constructor(message = 'NCDR API token is required: set NCDR_API_KEY') {
    super(message);
    this.name = 'NcdrCredentialError';
    this.code = 'NCDR_CREDENTIALS_MISSING';
  }
}

export class NcdrSourceError extends Error {
  constructor(message, { code = 'NCDR_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NcdrSourceError';
    this.code = code;
    this.status = status;
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeId(value, fieldName) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-');
  if (!normalized) throw new NcdrSourceError(`${fieldName} is required`, { code: 'NCDR_EVENT_ID_MISSING' });
  return normalized.slice(0, 240);
}

function normalizeTime(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NcdrSourceError(`${fieldName} is required`, { code: 'NCDR_TIME_MISSING' });
  }
  const trimmed = value.trim();
  const withTimezone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed;
  if (!RFC3339_RE.test(withTimezone)) {
    throw new NcdrSourceError(`${fieldName} must be an RFC 3339 date-time`, { code: 'NCDR_TIME_INVALID' });
  }
  const parsed = Date.parse(withTimezone);
  if (Number.isNaN(parsed)) {
    throw new NcdrSourceError(`${fieldName} must be an RFC 3339 date-time`, { code: 'NCDR_TIME_INVALID' });
  }
  return new Date(parsed).toISOString();
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function recordsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const records = payload.data
      ?? payload.records
      ?? payload.items
      ?? payload.alerts
      ?? payload.result?.records
      ?? payload.result?.data
      ?? payload.result?.items;
    if (Array.isArray(records)) return records;
    if (firstValue(payload.identifier, payload.Identifier, payload.CAPID, payload.capid, payload.id)) {
      return [payload];
    }
  }
  throw new NcdrSourceError('NCDR response must contain an alert record array', { code: 'NCDR_RECORDS_MISSING' });
}

function assertRawSnapshot(rawSnapshot) {
  const errors = validateRawSnapshot(rawSnapshot);
  if (errors.length > 0) {
    throw new NcdrSourceError(`invalid NCDR Raw snapshot: ${errors.join('; ')}`, { code: 'NCDR_RAW_INVALID' });
  }
  if (rawSnapshot.source_id !== 'ncdr-hazard-events') {
    throw new NcdrSourceError('NCDR normalizer requires source_id=ncdr-hazard-events', {
      code: 'NCDR_SOURCE_ID_INVALID',
    });
  }
}

function boundaryGeometry(boundary) {
  if (boundary?.type === 'Feature') return boundary.geometry;
  if (boundary?.type === 'FeatureCollection') return boundary.features?.[0]?.geometry;
  return boundary;
}

function fieldText(record, ...names) {
  for (const name of names) {
    const value = record?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
}

function numberField(record, ...names) {
  const value = fieldText(record, ...names);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function pointFromFields(record) {
  const latitude = numberField(
    record,
    'latitude', 'Latitude', 'lat', 'Lat', 'y', 'Y',
    'center_latitude', 'CenterLatitude',
  );
  const longitude = numberField(
    record,
    'longitude', 'Longitude', 'lon', 'Lon', 'lng', 'Lng', 'x', 'X',
    'center_longitude', 'CenterLongitude',
  );
  if (latitude === undefined && longitude === undefined) return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new NcdrSourceError('NCDR coordinate is invalid', { code: 'NCDR_GEOMETRY_INVALID' });
  }
  try {
    return { type: 'Point', coordinates: normalizeCoordinate([longitude, latitude]) };
  } catch (error) {
    throw new NcdrSourceError(`NCDR coordinate is invalid: ${error.message}`, {
      code: 'NCDR_GEOMETRY_INVALID',
      cause: error,
    });
  }
}

function capPolygon(value) {
  if (typeof value !== 'string') return undefined;
  const pairs = value
    .trim()
    .split(/[;\s]+/u)
    .filter(Boolean)
    .map((pair) => pair.split(',').map((item) => Number(item.trim())));
  if (pairs.length === 0 || pairs.some((pair) => pair.length !== 2 || pair.some((item) => !Number.isFinite(item)))) {
    throw new NcdrSourceError('NCDR CAP polygon is invalid', { code: 'NCDR_GEOMETRY_INVALID' });
  }
  const coordinates = pairs.map(([latitude, longitude]) => {
    try {
      return normalizeCoordinate([longitude, latitude]);
    } catch (error) {
      throw new NcdrSourceError(`NCDR CAP polygon coordinate is invalid: ${error.message}`, {
        code: 'NCDR_GEOMETRY_INVALID',
        cause: error,
      });
    }
  });
  if (coordinates.length < 3) {
    throw new NcdrSourceError('NCDR CAP polygon needs at least three positions', { code: 'NCDR_GEOMETRY_INVALID' });
  }
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
  return { type: 'Polygon', coordinates: [coordinates] };
}

function geometryFromValue(value) {
  const parsed = parseJsonValue(value);
  if (parsed?.type === 'Feature') return parsed.geometry;
  if (parsed?.type === 'FeatureCollection') return parsed.features?.[0]?.geometry;
  if (parsed?.type && (parsed.coordinates || parsed.geometries)) return parsed;
  return undefined;
}

function geometryFromRecord(record) {
  const direct = [
    record?.geometry,
    record?.Geometry,
    record?.geojson,
    record?.GeoJSON,
    record?.shape,
    record?.Shape,
  ].map(geometryFromValue).find(Boolean);
  if (direct) return direct;
  const polygon = firstValue(record?.polygon, record?.Polygon, record?.cap_polygon, record?.CAPPolygon);
  if (polygon) return capPolygon(polygon);
  return pointFromFields(record);
}

function isTaipeiScope(record) {
  const text = [
    fieldText(record, 'areaDesc', 'AreaDesc', 'area_desc', 'county', 'County', 'county_name', 'CountyName', 'city', 'City'),
    fieldText(record, 'geocode', 'GeoCode', 'location', 'Location', 'affected_area', 'AffectedArea'),
  ].filter(Boolean).join(' ');
  return /(?:臺北|台北)市/u.test(text);
}

function normalizeEventType(value) {
  const raw = String(value ?? '').trim();
  if (/淹水|積水|洪水|flood/u.test(raw)) return 'FLOOD_WARNING';
  if (/土石流|debris/u.test(raw)) return 'DEBRIS_FLOW_WARNING';
  if (/崩塌|山崩|landslide/u.test(raw)) return 'LANDSLIDE_WARNING';
  if (/雨量|大雨|豪雨|rain/u.test(raw)) return 'RAINFALL_WARNING';
  if (/地震|earthquake/u.test(raw)) return 'EARTHQUAKE_WARNING';
  return 'NCDR_HAZARD';
}

function themeForEventType(eventType) {
  if (eventType.startsWith('FLOOD')) return 'flood';
  if (eventType.startsWith('DEBRIS')) return 'debris_flow';
  if (eventType.startsWith('LANDSLIDE')) return 'landslide';
  if (eventType.startsWith('RAINFALL')) return 'rainfall';
  if (eventType.startsWith('EARTHQUAKE')) return 'earthquake';
  return 'hazard';
}

function normalizeSeverity(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (/EXTREME|極端|重大/u.test(raw)) return 'CRITICAL';
  if (/SEVERE|嚴重|高/u.test(raw)) return 'HIGH';
  if (/MODERATE|中/u.test(raw)) return 'MEDIUM';
  if (/MINOR|輕微|低/u.test(raw)) return 'LOW';
  return 'UNKNOWN';
}

function eventVersion(record) {
  const value = Number(firstValue(record.event_version, record.EventVersion, record.version, record.Version, 1));
  if (!Number.isInteger(value) || value < 1) {
    throw new NcdrSourceError('NCDR event version is invalid', { code: 'NCDR_EVENT_VERSION_INVALID' });
  }
  return value;
}

function sourceVersion(rawSnapshot, record, id) {
  return String(firstValue(
    record.source_version,
    record.SourceVersion,
    record.sent,
    record.Sent,
    record.updated_at,
    record.UpdateTime,
    id,
    rawSnapshot.response?.headers?.etag,
    rawSnapshot.retrieved_at,
  ));
}

function curatedGeometry(record, geometry, boundary) {
  if (geometry) {
    try {
      if (isGeometryInNeihu(geometry, boundary)) return { geometry, coverageLevel: 'district' };
    } catch (error) {
      throw new NcdrSourceError(`NCDR geometry is invalid: ${error.message}`, {
        code: 'NCDR_GEOMETRY_INVALID',
        cause: error,
      });
    }
  }
  if (isTaipeiScope(record)) {
    const fallback = boundaryGeometry(boundary);
    if (!fallback) throw new NcdrSourceError('Neihu boundary geometry is required', { code: 'NCDR_BOUNDARY_INVALID' });
    return { geometry: fallback, coverageLevel: 'city' };
  }
  if (!geometry) throw new NcdrSourceError('NCDR hazard geometry is required', { code: 'NCDR_GEOMETRY_MISSING' });
  return undefined;
}

function normalizeRecord(record, index, rawSnapshot, options) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new NcdrSourceError(`NCDR hazard record ${index} must be an object`, { code: 'NCDR_RECORD_INVALID' });
  }
  const id = normalizeId(
    firstValue(record.CAPID, record.capid, record.identifier, record.Identifier, record.event_id, record.EventID, record.alert_id, record.id),
    'NCDR CAPID or alert identifier',
  );
  const geometry = geometryFromRecord(record);
  const curated = curatedGeometry(record, geometry, options.boundary);
  if (!curated) return undefined;

  const eventType = normalizeEventType(firstValue(record.event, record.Event, record.event_type, record.EventType, record.hazard_type));
  const issuedAt = normalizeTime(
    firstValue(record.sent, record.Sent, record.effective, record.Effective, record.issue_time, record.IssueTime, record.issued_at),
    `NCDR hazard ${id} issued_at`,
  );
  const expiresAt = normalizeTime(
    firstValue(record.expires, record.Expires, record.expire_time, record.ExpireTime, record.end_time, record.EndTime, record.expires_at),
    `NCDR hazard ${id} expires_at`,
  );
  if (Date.parse(expiresAt) < Date.parse(issuedAt)) {
    throw new NcdrSourceError(`NCDR event ${id} expires before it is issued`, { code: 'NCDR_TIME_INVALID' });
  }

  const theme = themeForEventType(eventType);
  return {
    schema_version: 'event-v0',
    namespace: options.namespace ?? 'official.ncdr',
    event_id: `ncdr:${id}`,
    event_type: eventType,
    geometry: curated.geometry,
    severity: normalizeSeverity(firstValue(record.severity, record.Severity, record.urgency, record.Urgency)),
    source: 'NCDR',
    source_version: sourceVersion(rawSnapshot, record, id),
    event_version: eventVersion(record),
    issued_at: issuedAt,
    expires_at: expiresAt,
    attributes: {
      area_id: 'neihu',
      theme,
      coverage_level: curated.coverageLevel,
      alert_id: firstValue(record.CAPID, record.capid, record.identifier, record.Identifier, record.alert_id) ?? id,
      affected_area: firstValue(record.areaDesc, record.AreaDesc, record.affected_area, record.AffectedArea),
      source_description: firstValue(record.description, record.Description, record.source_description, record.SourceDescription),
      original_unit: firstValue(record.unit, record.Unit, record.units, record.Units),
      source_record: record,
    },
    signature_algorithm: 'Ed25519',
    signing_key_id: options.signingKeyId ?? 'ncdr-source-2026',
    provenance: {
      original_source: options.originalSource ?? rawSnapshot.request.url,
      received_at: options.receivedAt ?? rawSnapshot.retrieved_at,
      transport_source: options.transportSource ?? { kind: 'server', node_id: 'ncdr-collector' },
    },
  };
}

export function normalizeNcdrHazards(rawSnapshot, options = {}) {
  if (!options.boundary) throw new NcdrSourceError('Neihu boundary is required for NCDR curation', { code: 'NCDR_BOUNDARY_MISSING' });
  if (options.receivedAt !== undefined) normalizeTime(options.receivedAt, 'receivedAt');
  assertRawSnapshot(rawSnapshot);
  return recordsFromPayload(rawSnapshot.payload)
    .map((record, index) => normalizeRecord(record, index, rawSnapshot, options))
    .filter(Boolean);
}

function credentialValue(credentials) {
  if (typeof credentials === 'string') return credentials;
  return firstValue(credentials?.apiKey, credentials?.token, credentials?.NCDR_API_KEY, process.env.NCDR_API_KEY);
}

export async function fetchNcdrHazards({
  credentials = { apiKey: process.env.NCDR_API_KEY },
  endpoint = process.env.NCDR_API_ENDPOINT ?? DEFAULT_NCDR_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  timeoutMs = 30000,
  query = { format: 'JSON' },
} = {}) {
  const token = credentialValue(credentials);
  if (typeof token !== 'string' || token.trim() === '') throw new NcdrCredentialError();
  try {
    const result = await requestJson(endpoint, {
      fetchImpl,
      timeoutMs,
      headers: { Accept: 'application/json', Token: token },
      query,
    });
    return makeRawSnapshot({
      sourceId: 'ncdr-hazard-events',
      request: { method: 'GET', url: endpoint, query },
      responseStatus: result.status,
      responseHeaders: result.headers,
      retrievedAt,
      payload: result.payload,
    });
  } catch (error) {
    if (error instanceof NcdrSourceError) throw error;
    throw new NcdrSourceError(`NCDR request failed: ${error.message}`, {
      code: error.code === 'HTTP_ERROR' ? 'NCDR_HTTP_ERROR' : 'NCDR_REQUEST_ERROR',
      status: error.status ?? null,
      cause: error,
    });
  }
}
