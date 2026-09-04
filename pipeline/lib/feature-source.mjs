import { isGeometryInNeihu, normalizeCoordinate } from './geo.mjs';
import { makeRawSnapshot, requestText, validateRawSnapshot } from './source.mjs';

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const STATIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

export function fieldText(record, ...names) {
  const value = firstValue(...names.map((name) => record?.[name]));
  return value === undefined ? undefined : String(value).trim();
}

export function normalizeId(value, fieldName, ErrorClass) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-');
  if (!normalized) throw new ErrorClass(`${fieldName} is required`, { code: 'STATIC_FEATURE_ID_MISSING' });
  return normalized.slice(0, 240);
}

export function normalizeTime(value, fieldName, ErrorClass) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ErrorClass(`${fieldName} is required`, { code: 'STATIC_SOURCE_TIME_MISSING' });
  }
  const trimmed = value.trim();
  const withTimezone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed;
  if (!RFC3339_RE.test(withTimezone) || Number.isNaN(Date.parse(withTimezone))) {
    throw new ErrorClass(`${fieldName} must be an RFC 3339 date-time`, { code: 'STATIC_SOURCE_TIME_INVALID' });
  }
  return new Date(withTimezone).toISOString();
}

export function numberField(record, ...names) {
  const value = fieldText(record, ...names);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

export function pointFromFields(record, ErrorClass, latitudeNames, longitudeNames) {
  const latitude = numberField(record, ...latitudeNames);
  const longitude = numberField(record, ...longitudeNames);
  if (latitude === undefined && longitude === undefined) return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ErrorClass('static source coordinate is invalid', { code: 'STATIC_SOURCE_GEOMETRY_INVALID' });
  }
  try {
    return { type: 'Point', coordinates: normalizeCoordinate([longitude, latitude]) };
  } catch (error) {
    throw new ErrorClass(`static source coordinate is invalid: ${error.message}`, {
      code: 'STATIC_SOURCE_GEOMETRY_INVALID',
      cause: error,
    });
  }
}

export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV body must be a string');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/u, '') : header).trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function parseJsonOrCsv(body) {
  if (typeof body !== 'string') throw new TypeError('source body must be text');
  try {
    return JSON.parse(body);
  } catch {
    return { records: parseCsv(body), format: 'csv' };
  }
}

export function recordsFromPayload(payload, keys = ['records', 'results', 'data', 'items', 'resources']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') throw new TypeError('source payload must be an object or array');
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  for (const container of [payload.result, payload.data, payload.response]) {
    if (!container || typeof container !== 'object') continue;
    for (const key of keys) {
      if (Array.isArray(container[key])) return container[key];
    }
  }
  throw new TypeError('source payload does not contain records');
}

export function assertRawFeatureSnapshot(rawSnapshot, sourceId, ErrorClass) {
  const errors = validateRawSnapshot(rawSnapshot);
  if (errors.length > 0) throw new ErrorClass(`invalid Raw snapshot: ${errors.join('; ')}`, { code: 'STATIC_RAW_INVALID' });
  if (rawSnapshot.source_id !== sourceId) {
    throw new ErrorClass(`normalizer requires source_id=${sourceId}`, { code: 'STATIC_SOURCE_ID_INVALID' });
  }
}

export async function fetchStaticText({ sourceId, endpoint, fetchImpl, retrievedAt, query = {}, headers = {}, ErrorClass }) {
  try {
    const result = await requestText(endpoint, {
      fetchImpl,
      query,
      headers: {
        Accept: 'application/json, text/csv;q=0.9, text/plain;q=0.8',
        ...headers,
      },
    });
    return makeRawSnapshot({
      sourceId,
      request: { method: 'GET', url: endpoint, query },
      responseStatus: result.status,
      responseHeaders: result.headers,
      retrievedAt,
      payload: parseJsonOrCsv(result.body),
    });
  } catch (error) {
    if (error instanceof ErrorClass) throw error;
    throw new ErrorClass(`static source request failed: ${error.message}`, {
      code: error.code === 'HTTP_ERROR' ? 'STATIC_HTTP_ERROR' : 'STATIC_REQUEST_ERROR',
      status: error.status ?? null,
      cause: error,
    });
  }
}

export function staticTimes(rawSnapshot, options, ErrorClass) {
  const issuedAt = normalizeTime(options.issuedAt ?? rawSnapshot.retrieved_at, 'issued_at', ErrorClass);
  const explicitExpiresAt = options.expiresAt;
  const expiresAt = explicitExpiresAt
    ? normalizeTime(explicitExpiresAt, 'expires_at', ErrorClass)
    : new Date(Date.parse(issuedAt) + STATIC_TTL_MS).toISOString();
  if (Date.parse(expiresAt) < Date.parse(issuedAt)) {
    throw new ErrorClass('expires_at must not precede issued_at', { code: 'STATIC_SOURCE_TIME_INVALID' });
  }
  return { issuedAt, expiresAt };
}

export function featureBase({
  datasetId = 'resilientgeo-neihu',
  layerId,
  featureId,
  featureType,
  geometry,
  properties,
  source,
  sourceVersion,
  issuedAt,
  expiresAt,
  options = {},
  originalSource,
}) {
  return {
    schema_version: 'feature-v0',
    namespace: options.namespace ?? 'official.taipei',
    dataset_id: datasetId,
    layer_id: layerId,
    feature_id: featureId,
    feature_type: featureType,
    geometry,
    properties,
    source,
    source_version: String(sourceVersion),
    issued_at: issuedAt,
    expires_at: expiresAt,
    signature_algorithm: 'Ed25519',
    signing_key_id: options.signingKeyId ?? `${source.toLowerCase()}-source-2026`,
    provenance: {
      original_source: originalSource ?? 'local_fixture',
      received_at: options.receivedAt ?? issuedAt,
      transport_source: options.transportSource ?? { kind: 'server', node_id: `${source.toLowerCase()}-collector` },
    },
  };
}

export function isInsideNeihu(geometry, boundary, ErrorClass) {
  try {
    return isGeometryInNeihu(geometry, boundary);
  } catch (error) {
    throw new ErrorClass(`static source geometry is invalid: ${error.message}`, {
      code: 'STATIC_SOURCE_GEOMETRY_INVALID',
      cause: error,
    });
  }
}
