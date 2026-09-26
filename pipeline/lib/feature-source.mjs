import { inflateRawSync } from 'node:zlib';

import { isGeometryInBoundary, normalizeCoordinate } from './geo.mjs';
import { makeRawSnapshot, requestBytes, requestText, validateRawSnapshot } from './source.mjs';

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

function xmlAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return attributes.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'u'))?.[1];
}

function xmlText(fragment) {
  return String(fragment ?? '')
    .replace(/<text:line-break\s*\/?\s*>/gu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
    .trim();
}

/** Parse the tabular first sheet used by the MOHW medical master ODS. */
export function parseOdsXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') throw new TypeError('ODS content.xml must be non-empty text');
  const rows = [];
  const rowPattern = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gu;
  for (const rowMatch of xml.matchAll(rowPattern)) {
    const values = [];
    const cellPattern = /<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/gu;
    for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
      const attributes = cellMatch[1] ?? '';
      const repeated = Number(xmlAttribute(attributes, 'table:number-columns-repeated') ?? 1);
      if (!Number.isInteger(repeated) || repeated < 1) throw new TypeError('ODS cell repeat count is invalid');
      const value = xmlText(cellMatch[2])
        || xmlAttribute(attributes, 'office:string-value')
        || xmlAttribute(attributes, 'office:value')
        || '';
      // LibreOffice writes a 16K-column trailing empty run for this source.
      // It has no semantic columns, so do not materialize it in memory.
      if (repeated > 1000 && value === '') continue;
      for (let index = 0; index < Math.min(repeated, 1000); index += 1) values.push(value);
    }
    const rowRepeated = Number(xmlAttribute(rowMatch[1] ?? '', 'table:number-rows-repeated') ?? 1);
    if (!Number.isInteger(rowRepeated) || rowRepeated < 1) throw new TypeError('ODS row repeat count is invalid');
    if (values.some((value) => value !== '')) {
      for (let index = 0; index < Math.min(rowRepeated, 1000); index += 1) rows.push(values);
    }
  }
  if (rows.length < 2) throw new TypeError('ODS table must contain a header and at least one record');
  const headers = rows[0].map((value, index) => String(value).replace(/^\uFEFF/u, '').trim() || `column_${index + 1}`);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function uint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes, offset) {
  return bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] * 0x1000000);
}

function zipEntry(bytes, targetName) {
  const endOfCentralDirectory = 0x06054b50;
  const centralDirectoryHeader = 0x02014b50;
  const localFileHeader = 0x04034b50;
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (uint32(bytes, offset) === endOfCentralDirectory) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new TypeError('ODS is not a ZIP container');
  const count = uint16(bytes, end + 10);
  let cursor = uint32(bytes, end + 16);
  for (let index = 0; index < count; index += 1) {
    if (uint32(bytes, cursor) !== centralDirectoryHeader) throw new TypeError('ODS ZIP central directory is invalid');
    const compression = uint16(bytes, cursor + 10);
    const compressedSize = uint32(bytes, cursor + 20);
    const nameLength = uint16(bytes, cursor + 28);
    const extraLength = uint16(bytes, cursor + 30);
    const commentLength = uint16(bytes, cursor + 32);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localOffset = uint32(bytes, cursor + 42);
    if (name === targetName) {
      if (uint32(bytes, localOffset) !== localFileHeader) throw new TypeError('ODS ZIP local file header is invalid');
      const localNameLength = uint16(bytes, localOffset + 26);
      const localExtraLength = uint16(bytes, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = Buffer.from(bytes.slice(start, start + compressedSize));
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRawSync(compressed);
      throw new TypeError(`ODS ZIP compression method ${compression} is unsupported`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new TypeError(`ODS ZIP entry ${targetName} is missing`);
}

export function parseOds(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('ODS body must be Uint8Array');
  const xml = new TextDecoder('utf-8').decode(zipEntry(bytes, 'content.xml'));
  return parseOdsXml(xml);
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

export async function fetchStaticText({ sourceId, endpoint, fetchImpl, retrievedAt, query = {}, headers = {}, ErrorClass, timeoutMs = 30000, maxAttempts = 3 }) {
  try {
    const result = await requestText(endpoint, {
      fetchImpl,
      query,
      timeoutMs,
      maxAttempts,
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

export async function fetchStaticBinary({ sourceId, endpoint, fetchImpl, retrievedAt, query = {}, headers = {}, ErrorClass, format, timeoutMs = 30000, maxAttempts = 3 }) {
  try {
    const result = await requestBytes(endpoint, {
      fetchImpl,
      query,
      timeoutMs,
      maxAttempts,
      headers: {
        Accept: 'application/vnd.oasis.opendocument.spreadsheet, application/octet-stream;q=0.9',
        ...headers,
      },
    });
    const records = format === 'ods' ? parseOds(result.body) : undefined;
    return makeRawSnapshot({
      sourceId,
      request: { method: 'GET', url: endpoint, query },
      responseStatus: result.status,
      responseHeaders: result.headers,
      retrievedAt,
      payload: { format: format ?? 'binary', records },
    });
  } catch (error) {
    if (error instanceof ErrorClass) throw error;
    throw new ErrorClass(`static binary source request failed: ${error.message}`, {
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
  datasetId,
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
    dataset_id: datasetId ?? (options.scope === 'taiwan' ? 'resilientgeo-taiwan' : 'resilientgeo-neihu'),
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
    return isGeometryInBoundary(geometry, boundary);
  } catch (error) {
    throw new ErrorClass(`static source geometry is invalid: ${error.message}`, {
      code: 'STATIC_SOURCE_GEOMETRY_INVALID',
      cause: error,
    });
  }
}

export function isInsideBoundary(geometry, boundary, ErrorClass) {
  try {
    return isGeometryInBoundary(geometry, boundary);
  } catch (error) {
    throw new ErrorClass(`static source geometry is invalid: ${error.message}`, {
      code: 'STATIC_SOURCE_GEOMETRY_INVALID',
      cause: error,
    });
  }
}
