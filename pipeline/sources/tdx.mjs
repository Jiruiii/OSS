import {
  filterRecordsToNeihu,
} from '../lib/geo.mjs';
import {
  makeRawSnapshot,
  requestJson,
  validateRawSnapshot,
} from '../lib/source.mjs';

export const DEFAULT_TDX_ENDPOINT = 'https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/LiveEvent/City/Taipei?$format=JSON';
export const DEFAULT_TDX_TOKEN_ENDPOINT = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN']);

export class TdxCredentialError extends Error {
  constructor(message = 'TDX credentials are required: set TDX_CLIENT_ID and TDX_CLIENT_SECRET') {
    super(message);
    this.name = 'TdxCredentialError';
    this.code = 'TDX_CREDENTIALS_MISSING';
  }
}

export class TdxSourceError extends Error {
  constructor(message, { code = 'TDX_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TdxSourceError';
    this.code = code;
    this.status = status;
  }
}

function assertTimestamp(value, fieldName) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TdxSourceError(`${fieldName} must be a valid RFC 3339 date-time`, {
      code: 'TDX_INVALID_SOURCE_TIME',
    });
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function eventRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') {
    throw new TdxSourceError('TDX response must be a JSON object or array', { code: 'TDX_INVALID_PAYLOAD' });
  }
  for (const key of ['LiveEvents', 'Events', 'events', 'Records', 'records']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  throw new TdxSourceError('TDX response must contain an Events array', { code: 'TDX_EVENTS_MISSING' });
}

function sourceVersion(rawSnapshot, payload, record) {
  const value = firstValue(
    rawSnapshot.source_version,
    payload?.UpdateTime,
    payload?.update_time,
    payload?.LastUpdateTime,
    payload?.last_update_time,
    record?.LastUpdateTime,
    record?.last_update_time,
    record?.UpdateTime,
    record?.update_time,
    rawSnapshot.response?.headers?.etag,
    rawSnapshot.retrieved_at,
  );
  if (!value) throw new TdxSourceError('TDX response must contain a source version', { code: 'TDX_SOURCE_VERSION_MISSING' });
  return String(value);
}

function sourceEventId(record) {
  return firstValue(
    record?.EventID,
    record?.EventId,
    record?.event_id,
    record?.eventId,
    record?.ID,
    record?.Id,
    record?.id,
    record?.EventNo,
    record?.event_no,
  );
}

function normalizeEventId(value) {
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9._:-]+/gu, '-');
  if (!normalized) throw new TdxSourceError('TDX event stable identity is empty', { code: 'TDX_EVENT_ID_MISSING' });
  return `tdx:${normalized}`;
}

function normalizeEventType(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new TdxSourceError('TDX event type is required', { code: 'TDX_EVENT_TYPE_MISSING' });
  }
  const raw = String(value).trim();
  const categoryCodes = {
    '1': 'ROAD_ACCIDENT',
    '2': 'ROAD_CONSTRUCTION',
    '3': 'TRAFFIC_CONGESTION',
    '4': 'TRAFFIC_CONTROL',
    '5': 'ROAD_WEATHER',
    '6': 'ROAD_DISASTER',
    '7': 'ROAD_ACTIVITY',
    '8': 'ROAD_ANOMALY',
  };
  if (categoryCodes[raw] !== undefined) return categoryCodes[raw];
  if (/^[1-8]\d{2}$/u.test(raw) && categoryCodes[raw[0]] !== undefined) return categoryCodes[raw[0]];
  const knownTypes = new Map([
    ['accident', 'ROAD_ACCIDENT'],
    ['road accident', 'ROAD_ACCIDENT'],
    ['roadclosed', 'ROAD_CLOSED'],
    ['road closed', 'ROAD_CLOSED'],
    ['closure', 'ROAD_CLOSED'],
    ['construction', 'ROAD_CONSTRUCTION'],
    ['road construction', 'ROAD_CONSTRUCTION'],
    ['trafficcontrol', 'TRAFFIC_CONTROL'],
    ['traffic control', 'TRAFFIC_CONTROL'],
    ['congestion', 'TRAFFIC_CONGESTION'],
    ['weather', 'ROAD_WEATHER'],
    ['disaster', 'ROAD_DISASTER'],
  ]);
  const known = knownTypes.get(raw.toLowerCase());
  if (known) return known;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9._:-]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (normalized.length < 3) throw new TdxSourceError('TDX event type is invalid', { code: 'TDX_EVENT_TYPE_INVALID' });
  return normalized.slice(0, 64);
}

function normalizeSeverity(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 'UNKNOWN';
  const raw = String(value).trim().toUpperCase();
  if (SEVERITIES.has(raw)) return raw;
  if (/CRITICAL|重大/u.test(raw)) return 'CRITICAL';
  if (/HIGH|嚴重|高/u.test(raw)) return 'HIGH';
  if (/MEDIUM|中/u.test(raw)) return 'MEDIUM';
  if (/LOW|輕微|低/u.test(raw)) return 'LOW';
  if (/^[1-4]$/u.test(raw)) return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][Number(raw) - 1];
  return 'UNKNOWN';
}

function coordinateFromPosition(value) {
  const position = parseJsonValue(value);
  if (Array.isArray(position) && position.length >= 2) return [Number(position[0]), Number(position[1])];
  if (!position || typeof position !== 'object') return null;
  const latitude = firstValue(
    position.PositionLat,
    position.position_lat,
    position.Latitude,
    position.latitude,
    position.Lat,
    position.lat,
  );
  const longitude = firstValue(
    position.PositionLon,
    position.position_lon,
    position.Longitude,
    position.longitude,
    position.Lon,
    position.lon,
  );
  if (latitude === undefined || longitude === undefined) return null;
  return [Number(longitude), Number(latitude)];
}

function unwrapWktBody(value) {
  const text = value.trim();
  if (!text.startsWith('(') || !text.endsWith(')')) return text;
  return text.slice(1, -1).trim();
}

function topLevelGroups(value) {
  const groups = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') {
      depth += 1;
      if (depth === 1) start = index + 1;
    } else if (value[index] === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        groups.push(value.slice(start, index).trim());
        start = -1;
      }
    }
  }
  return groups;
}

function wktCoordinateList(value) {
  return value.split(',').map((part) => part.trim().split(/\s+/u).slice(0, 3).map(Number));
}

function wktGeometry(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING)\s*(?:Z|M|ZM)?\s*(EMPTY|\(.*\))$/iu);
  if (!match || match[2].toUpperCase() === 'EMPTY') return null;
  const type = match[1].toUpperCase();
  const body = unwrapWktBody(match[2]);
  if (type === 'POINT') {
    const coordinates = wktCoordinateList(body)[0];
    return coordinates?.length >= 2 ? { type: 'Point', coordinates } : null;
  }
  if (type === 'LINESTRING') {
    const coordinates = wktCoordinateList(body);
    return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
  }
  if (type === 'POLYGON') {
    const coordinates = topLevelGroups(body).map(wktCoordinateList);
    return coordinates.length > 0 ? { type: 'Polygon', coordinates } : null;
  }
  if (type === 'MULTIPOINT') {
    const coordinates = topLevelGroups(body).map((group) => wktCoordinateList(unwrapWktBody(group))[0]);
    return coordinates.length > 0 ? { type: 'MultiPoint', coordinates } : null;
  }
  if (type === 'MULTILINESTRING') {
    const coordinates = topLevelGroups(body).map((group) => wktCoordinateList(unwrapWktBody(group)));
    return coordinates.length > 0 ? { type: 'MultiLineString', coordinates } : null;
  }
  return null;
}

function geometryFromValue(value) {
  const parsed = parseJsonValue(value);
  if (parsed?.type === 'Feature') return parsed.geometry;
  if (parsed?.type === 'FeatureCollection' || parsed?.type === 'GeometryCollection') return parsed;
  if (parsed?.type && parsed?.coordinates) return parsed;
  return wktGeometry(parsed);
}

function geometryFromRecord(record) {
  const directGeometry = [
    record?.geometry,
    record?.Geometry,
    record?.Positions,
    record?.Location?.geometry,
    record?.Location?.Geometry,
    record?.Location?.Positions,
  ].map(geometryFromValue).find(Boolean);
  if (directGeometry) return directGeometry;

  const location = record?.Location ?? record?.location ?? {};
  const positions = firstValue(
    location.Positions,
    location.positions,
    record?.Positions,
    record?.positions,
  );
  if (Array.isArray(positions)) {
    const coordinates = positions.map(coordinateFromPosition).filter(Boolean);
    if (coordinates.length === 1) return { type: 'Point', coordinates: coordinates[0] };
    if (coordinates.length >= 2) return { type: 'LineString', coordinates };
  }

  const coordinate = coordinateFromPosition(firstValue(
    location.Position,
    location.position,
    location,
    record?.Position,
    record?.position,
  ));
  if (coordinate) return { type: 'Point', coordinates: coordinate };
  return null;
}

function collectTowns(record) {
  const roadways = [
    ...(record?.Location?.CityRoad?.Roadways ?? []),
    ...(record?.Location?.city_road?.roadways ?? []),
    ...(record?.RoadEvent?.Roadways ?? []),
    ...(record?.RoadEvent?.roadways ?? []),
  ];
  return [
    record?.Town,
    record?.town,
    record?.Location?.Address?.Town,
    record?.Location?.Address?.town,
    record?.Location?.Town,
    record?.Location?.town,
    ...roadways.map((roadway) => roadway?.Town ?? roadway?.town),
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value).trim());
}

function isNeihuTown(town) {
  return town.includes('內湖') || town.includes('内湖');
}

function sourceFreshnessExpiry(rawSnapshot, payload) {
  const sourceTime = firstValue(
    payload?.UpdateTime,
    payload?.update_time,
    rawSnapshot.retrieved_at,
  );
  const updateInterval = Number(firstValue(payload?.UpdateInterval, payload?.update_interval));
  if (!sourceTime || !Number.isFinite(updateInterval) || updateInterval <= 0) return undefined;
  if (Number.isNaN(Date.parse(sourceTime))) return undefined;
  return new Date(Date.parse(sourceTime) + updateInterval * 1000).toISOString();
}

function normalizeRecord(record, index, rawSnapshot, payload, options) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TdxSourceError(`TDX event ${index} must be an object`, { code: 'TDX_EVENT_INVALID' });
  }
  const stableId = sourceEventId(record);
  if (stableId === undefined) {
    throw new TdxSourceError(`TDX event ${index} stable identity is required`, { code: 'TDX_EVENT_ID_MISSING' });
  }
  const geometry = geometryFromRecord(record);
  if (!geometry) {
    throw new TdxSourceError(`TDX event ${stableId} geometry is required`, { code: 'TDX_EVENT_GEOMETRY_MISSING' });
  }
  const issuedAt = firstValue(
    record.EffectiveTime,
    record.effective_time,
    record.StartTime,
    record.start_time,
    record.PublishTime,
    record.publish_time,
    record.IssuedAt,
    record.issued_at,
    rawSnapshot.issued_at,
  );
  const expiresAt = firstValue(
    record.ExpireTime,
    record.expire_time,
    record.EndTime,
    record.end_time,
    record.ExpiresAt,
    record.expires_at,
    rawSnapshot.expires_at,
    sourceFreshnessExpiry(rawSnapshot, payload),
  );
  assertTimestamp(issuedAt, `TDX event ${stableId} source start time`);
  assertTimestamp(expiresAt, `TDX event ${stableId} source end time`);
  if (Date.parse(expiresAt) < Date.parse(issuedAt)) {
    throw new TdxSourceError(`TDX event ${stableId} source end time precedes start time`, {
      code: 'TDX_INVALID_SOURCE_TIME',
    });
  }

  const eventVersionValue = firstValue(
    record.EventVersion,
    record.event_version,
    record.Version,
    record.version,
  );
  const eventVersion = eventVersionValue === undefined ? 1 : Number(eventVersionValue);
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new TdxSourceError(`TDX event ${stableId} event version is invalid`, { code: 'TDX_EVENT_VERSION_INVALID' });
  }
  const towns = collectTowns(record);
  const sourceAttributes = record.attributes ?? record.properties;
  return {
    townMatches: towns.length === 0 || towns.some(isNeihuTown),
    event: {
      schema_version: 'event-v0',
      namespace: options.namespace ?? 'official.tdx',
      event_id: normalizeEventId(stableId),
      event_type: normalizeEventType(firstValue(record.EventType, record.event_type, record.Type, record.type)),
      geometry,
      severity: normalizeSeverity(firstValue(record.Severity, record.severity, record.EventLevel, record.event_level)),
      source: 'TDX',
      source_version: sourceVersion(rawSnapshot, payload, record),
      event_version: eventVersion,
      issued_at: issuedAt,
      expires_at: expiresAt,
      attributes: {
        source_record: record,
        ...(sourceAttributes && typeof sourceAttributes === 'object' ? { source_attributes: sourceAttributes } : {}),
      },
      signature_algorithm: 'Ed25519',
      signing_key_id: options.signingKeyId ?? 'tdx-source-2026',
      provenance: {
        original_source: options.originalSource ?? rawSnapshot.request.url,
        received_at: options.receivedAt ?? rawSnapshot.retrieved_at,
        transport_source: options.transportSource ?? {
          kind: 'server',
          node_id: 'tdx-collector',
        },
      },
    },
  };
}

function assertRawSnapshot(rawSnapshot) {
  const errors = validateRawSnapshot(rawSnapshot);
  if (errors.length > 0) {
    throw new TdxSourceError(`invalid TDX Raw snapshot: ${errors.join('; ')}`, { code: 'TDX_RAW_INVALID' });
  }
  if (rawSnapshot.source_id !== 'tdx-road-events') {
    throw new TdxSourceError('TDX normalizer requires source_id=tdx-road-events', { code: 'TDX_SOURCE_ID_INVALID' });
  }
}

export function normalizeTdxRoadEvents(rawSnapshot, options = {}) {
  assertRawSnapshot(rawSnapshot);
  if (!options.boundary) throw new TdxSourceError('Neihu boundary is required for TDX curation', { code: 'TDX_BOUNDARY_MISSING' });
  const receivedAt = options.receivedAt ?? rawSnapshot.retrieved_at;
  assertTimestamp(receivedAt, 'receivedAt');
  const payload = rawSnapshot.payload;
  const records = eventRecords(payload).map((record, index) => normalizeRecord(
    record,
    index,
    rawSnapshot,
    payload,
    { ...options, receivedAt },
  ));
  const townFiltered = records.filter((record) => record.townMatches);
  return filterRecordsToNeihu(townFiltered, options.boundary, (record) => record.event.geometry)
    .map((record) => record.event);
}

async function fetchTdxAccessToken({ clientId, clientSecret, tokenEndpoint, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: controller.signal,
    });
    if (!response || typeof response.status !== 'number') {
      throw new TdxSourceError('TDX token response has no HTTP status', { code: 'TDX_AUTH_ERROR' });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new TdxSourceError(`TDX token request failed with HTTP ${response.status}`, {
        code: 'TDX_AUTH_ERROR',
        status: response.status,
      });
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new TdxSourceError('TDX token response is not valid JSON', { code: 'TDX_AUTH_ERROR', cause: error });
    }
    if (!payload || typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new TdxSourceError('TDX token response does not contain access_token', { code: 'TDX_AUTH_ERROR' });
    }
    return payload.access_token;
  } catch (error) {
    if (error instanceof TdxSourceError) throw error;
    throw new TdxSourceError('TDX token request failed', { code: 'TDX_AUTH_ERROR', cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTdxRoadEvents({
  clientId = process.env.TDX_CLIENT_ID,
  clientSecret = process.env.TDX_CLIENT_SECRET,
  endpoint = process.env.TDX_API_ENDPOINT ?? DEFAULT_TDX_ENDPOINT,
  tokenEndpoint = process.env.TDX_TOKEN_ENDPOINT ?? DEFAULT_TDX_TOKEN_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  timeoutMs = 30000,
} = {}) {
  if (typeof clientId !== 'string' || clientId.length === 0 || typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new TdxCredentialError();
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  assertTimestamp(retrievedAt, 'retrievedAt');

  const accessToken = await fetchTdxAccessToken({
    clientId,
    clientSecret,
    tokenEndpoint,
    fetchImpl,
    timeoutMs,
  });
  const result = await requestJson(endpoint, {
    fetchImpl,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    timeoutMs,
  });
  return makeRawSnapshot({
    sourceId: 'tdx-road-events',
    request: {
      method: 'GET',
      url: endpoint,
      query: { $format: 'JSON' },
    },
    responseStatus: result.status,
    responseHeaders: result.headers,
    retrievedAt,
    payload: result.payload,
  });
}

export async function collectTdxRoadEvents(options = {}) {
  const rawSnapshot = await fetchTdxRoadEvents(options);
  const events = normalizeTdxRoadEvents(rawSnapshot, options);
  return { rawSnapshot, events };
}
