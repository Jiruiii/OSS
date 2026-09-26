import {
  assertRawFeatureSnapshot,
  featureBase,
  fetchStaticText,
  fieldText,
  firstValue,
  isInsideBoundary,
  normalizeId,
  pointFromFields,
  recordsFromPayload,
  staticTimes,
} from '../lib/feature-source.mjs';
import { areaMetadataForRecord } from '../lib/coverage.mjs';
import { normalizeCoordinate } from '../lib/geo.mjs';
import { makeRawSnapshot, requestText } from '../lib/source.mjs';

export const DEFAULT_SHELTER_ENDPOINT = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/ED6CF735-6C03-4573-A882-72C1BEC799CB/resource/54550E2F-4567-4C8F-BD2E-E54E9D0386B8/download';
export const DEFAULT_SHELTER_STATUS_ENDPOINT = 'https://portal2.emic.gov.tw/Pub/EEA2/OpenData/Shelter.xml';

export class ShelterSourceError extends Error {
  constructor(message, { code = 'SHELTER_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ShelterSourceError';
    this.code = code;
    this.status = status;
  }
}

function sourceVersion(rawSnapshot, record, id) {
  return String(firstValue(
    fieldText(record, '資料更新時間', '更新時間', 'UpdateTime', 'updated_at'),
    rawSnapshot.response?.headers?.etag,
    rawSnapshot.response?.headers?.last_modified,
    rawSnapshot.retrieved_at,
    id,
  ));
}

function administrativeArea(record) {
  const direct = fieldText(
    record,
    '縣市及鄉鎮市區',
    '縣市鄉鎮市區',
    '行政區',
    '行政區域',
    'area',
    'district',
  );
  if (direct) return direct;
  return [fieldText(record, '縣市', 'county', 'County'), fieldText(record, '鄉鎮市區', 'town', 'Town')]
    .filter(Boolean)
    .join('') || undefined;
}

function isNeihuRecord(record) {
  const area = administrativeArea(record);
  const address = fieldText(record, '避難收容處所地址', '地址', 'address');
  return /(?:臺北|台北)市?\s*內湖區/u.test(`${area ?? ''} ${address ?? ''}`)
    || /內湖區/u.test(area ?? '')
    || /內湖區/u.test(address ?? '');
}

function disasterTypes(record) {
  const value = fieldText(record, '適用災害類別', '災害類別', 'disaster_type', 'disaster_types', 'disastertype');
  if (value === undefined) return [];
  return value.split(/[;,、，|/]+/u).map((item) => item.trim()).filter(Boolean);
}

function shelterId(record, index) {
  const value = firstValue(
    fieldText(record, '序號', '編號', '避難收容處所編號', '收容所編號', 'shelterCode', 'sheltercode', 'shelterId', 'shelterid', 'id', 'ID'),
    `${fieldText(record, '避難收容處所名稱', '收容所名稱', '名稱', 'name') ?? ''}:${fieldText(record, '避難收容處所地址', '地址', 'address') ?? ''}`,
  );
  if (!value) throw new ShelterSourceError(`shelter record ${index} has no stable identity`, { code: 'SHELTER_FEATURE_ID_MISSING' });
  return normalizeId(value, 'shelter identity', ShelterSourceError);
}

function twd97Tm2ToWgs84(x, y, centralMeridian = 121) {
  const a = 6378137;
  const eccentricitySquared = 0.00669438002290;
  const scale = 0.9999;
  const falseEasting = 250000;
  const falseNorthing = 0;
  const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared);
  const meridionalArc = (y - falseNorthing) / scale;
  const mu = meridionalArc / (a * (1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64 - 5 * eccentricitySquared ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - eccentricitySquared)) / (1 + Math.sqrt(1 - eccentricitySquared));
  const footpointLatitude = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sine = Math.sin(footpointLatitude);
  const cosine = Math.cos(footpointLatitude);
  const tangent = Math.tan(footpointLatitude);
  const radiusPrime = a / Math.sqrt(1 - eccentricitySquared * sine ** 2);
  const radiusMeridian = a * (1 - eccentricitySquared) / (1 - eccentricitySquared * sine ** 2) ** 1.5;
  const distance = (x - falseEasting) / scale;
  const t = tangent ** 2;
  const c = eccentricityPrimeSquared * cosine ** 2;
  const d = distance / radiusPrime;
  const latitude = footpointLatitude - (radiusPrime * tangent / radiusMeridian) * (
    d ** 2 / 2
    - (5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * eccentricityPrimeSquared) * d ** 4 / 24
    + (61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * eccentricityPrimeSquared - 3 * c ** 2) * d ** 6 / 720
  );
  const longitude = (centralMeridian * Math.PI) / 180 + (
    d
    - (1 + 2 * t + c) * d ** 3 / 6
    + (5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * eccentricityPrimeSquared + 24 * t ** 2) * d ** 5 / 120
  ) / cosine;
  return [longitude * 180 / Math.PI, latitude * 180 / Math.PI];
}

function shelterGeometry(record, index) {
  const latitude = Number(fieldText(record, '緯度', '緯度(WGS84)', 'Latitude', 'latitude', 'lat'));
  const longitude = Number(fieldText(record, '經度', '經度(WGS84)', 'Longitude', 'longitude', 'lon', 'lng'));
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { type: 'Point', coordinates: normalizeCoordinate([longitude, latitude]) };
    }
    // Some shelter rows publish longitude in lat and latitude in lon.
    if (Math.abs(latitude) <= 180 && Math.abs(longitude) <= 90) {
      return { type: 'Point', coordinates: normalizeCoordinate([latitude, longitude]) };
    }
    // A small subset uses TWD97 / TM2 coordinates in the lat/lon fields.
    if (longitude >= 150000 && longitude <= 400000 && latitude >= 2400000 && latitude <= 2900000) {
      const areaText = `${fieldText(record, '縣市', 'county', 'County') ?? ''}${fieldText(record, '鄉鎮市區', 'town', 'Town') ?? ''}`;
      const centralMeridian = /金門|連江/u.test(areaText) ? 119 : 121;
      return { type: 'Point', coordinates: normalizeCoordinate(twd97Tm2ToWgs84(longitude, latitude, centralMeridian)) };
    }
  }
  const geometry = pointFromFields(
    record,
    ShelterSourceError,
    ['緯度', '緯度(WGS84)', 'Latitude', 'latitude', 'lat'],
    ['經度', '經度(WGS84)', 'Longitude', 'longitude', 'lon', 'lng'],
  );
  if (!geometry) throw new ShelterSourceError(`shelter record ${index} has no coordinate`, { code: 'SHELTER_GEOMETRY_MISSING' });
  return geometry;
}

function statusValue(record) {
  const value = firstValue(
    fieldText(record, '開設狀態', '開設情形', '開設狀況', '收容所狀態', 'openstatus', 'openStatus', 'status', 'Status'),
  );
  if (value === undefined) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (/FULL|滿|額滿/u.test(raw)) return 'FULL';
  if (/CLOSED|關閉|未開設|停用|撤除/u.test(raw)) return 'CLOSED';
  if (/OPEN|開設|啟用|可用/u.test(raw)) return 'OPEN';
  return 'UNKNOWN';
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/<[^>]+>/gu, '')
    .trim();
}

function parseShelterStatusXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new ShelterSourceError('shelter status XML body is empty', { code: 'SHELTER_STATUS_XML_INVALID' });
  }
  const records = [];
  // The official feed uses a misspelled, nested <ShletersInfo> wrapper. Keep
  // the parser tolerant of both that shape and the simple test/documentation
  // shapes, while selecting only innermost shelter blocks.
  const blockPattern = /<(ShletersInfo|shelter|item|record|row)\b[^>]*>([\s\S]*?)<\/\1>/giu;
  for (const match of xml.matchAll(blockPattern)) {
    if (match[1].toLowerCase() === 'shletersinfo' && /<ShletersInfo\b/iu.test(match[2])) continue;
    const record = {};
    const fieldPattern = /<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gu;
    for (const field of match[2].matchAll(fieldPattern)) {
      record[field[1]] = decodeXml(field[2]);
    }
    if (Object.keys(record).length > 0) records.push(record);
  }
  if (records.length === 0) {
    throw new ShelterSourceError('shelter status XML contains no shelter records', { code: 'SHELTER_STATUS_XML_INVALID' });
  }
  const unique = new Map();
  for (const record of records) {
    const identity = firstValue(record.shelterCode, record.shelterId, record.id);
    if (identity === undefined) {
      unique.set(`row:${unique.size}`, record);
    } else {
      unique.set(`id:${identity}`, record);
    }
  }
  return [...unique.values()];
}

function statusEvent({ rawSnapshot, record, id, geometry, issuedAt, expiresAt, eventVersion, status, options }) {
  const area = areaMetadataForRecord(options, record, geometry);
  return {
    schema_version: 'event-v0',
    namespace: options.namespace ?? 'official.fire',
    event_id: `shelter:${id}:status`,
    event_type: 'SHELTER_STATUS',
    geometry,
    severity: 'UNKNOWN',
    source: 'FIRE_AGENCY',
    source_version: sourceVersion(rawSnapshot, record, id),
    event_version: eventVersion,
    issued_at: issuedAt,
    expires_at: expiresAt,
    attributes: {
      ...area,
      theme: 'shelter',
      ...(options.coverage ? { coverage: options.coverage } : {}),
      shelter_id: id,
      status,
      source_record: record,
    },
    signature_algorithm: 'Ed25519',
    signing_key_id: options.signingKeyId ?? 'fire-agency-source-2026',
    provenance: {
      original_source: options.originalSource ?? rawSnapshot.request.url,
      received_at: options.receivedAt ?? rawSnapshot.retrieved_at,
      transport_source: options.transportSource ?? { kind: 'server', node_id: 'shelter-collector' },
    },
  };
}

function normalizeShelterRecord(record, index, rawSnapshot, options) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ShelterSourceError(`shelter record ${index} must be an object`, { code: 'SHELTER_RECORD_INVALID' });
  }
  if (options.scope !== 'taiwan' && !isNeihuRecord(record)) return undefined;
  const id = shelterId(record, index);
  const geometry = shelterGeometry(record, index);
  if (!isInsideBoundary(geometry, options.boundary, ShelterSourceError)) return undefined;
  const name = fieldText(record, '避難收容處所名稱', '收容所名稱', '名稱', 'name');
  const address = fieldText(record, '避難收容處所地址', '地址', 'address');
  const area = areaMetadataForRecord(options, record, geometry);
  const capacity = Number(firstValue(fieldText(record, '預計收容人數', '收容人數', 'capacity', 'peopleno'), ''));
  const properties = {
    name: name ?? null,
    address: address ?? null,
    capacity: Number.isFinite(capacity) ? capacity : null,
    disaster_types: disasterTypes(record),
    administrative_area: administrativeArea(record) ?? null,
    ...area,
    ...(options.coverage ? { coverage: options.coverage } : {}),
    source_record: record,
  };
  const eventVersion = Number(firstValue(
    fieldText(record, '事件版本', '資料版本', '版本', 'event_version', 'version'),
    1,
  ));
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new ShelterSourceError(`shelter ${id} event version is invalid`, { code: 'SHELTER_EVENT_VERSION_INVALID' });
  }
  const sourceVersionValue = sourceVersion(rawSnapshot, record, id);
  const status = statusValue(record);
  const feature = featureBase({
    datasetId: options.datasetId,
    layerId: 'shelter',
    featureId: `shelter:${id}`,
    featureType: 'SHELTER',
    geometry,
    properties,
    source: options.sourceId ?? rawSnapshot.source_id,
    sourceVersion: sourceVersionValue,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    options,
    originalSource: rawSnapshot.request.url,
  });
  return {
    feature,
    statusEvent: status === undefined ? undefined : statusEvent({
      rawSnapshot,
      record,
      id,
      geometry,
      issuedAt: options.issuedAt,
      expiresAt: options.expiresAt,
      eventVersion,
      status,
      options,
    }),
  };
}

export function normalizeShelters(rawSnapshot, options = {}) {
  if (!options.boundary) throw new ShelterSourceError('Shelter scope boundary is required for curation', { code: 'SHELTER_BOUNDARY_MISSING' });
  const sourceId = options.sourceId ?? rawSnapshot.source_id;
  if (!['taipei-shelter', 'taiwan-shelter'].includes(sourceId)) {
    throw new ShelterSourceError(`shelter normalizer requires source_id=taipei-shelter or taiwan-shelter`, { code: 'STATIC_SOURCE_ID_INVALID' });
  }
  assertRawFeatureSnapshot(rawSnapshot, sourceId, ShelterSourceError);
  const times = staticTimes(rawSnapshot, options, ShelterSourceError);
  const normalizedOptions = { ...options, ...times };
  const pairs = recordsFromPayload(rawSnapshot.payload)
    .map((record, index) => normalizeShelterRecord(record, index, rawSnapshot, normalizedOptions))
    .filter(Boolean)
    .sort((left, right) => left.feature.feature_id.localeCompare(right.feature.feature_id));
  return {
    features: pairs.map((pair) => pair.feature),
    statusEvents: pairs.map((pair) => pair.statusEvent).filter(Boolean),
  };
}

export function normalizeShelterStatuses(rawSnapshot, options = {}) {
  if (!options.boundary) throw new ShelterSourceError('Shelter status scope boundary is required for curation', { code: 'SHELTER_BOUNDARY_MISSING' });
  const sourceId = options.sourceId ?? rawSnapshot.source_id;
  if (sourceId !== 'taiwan-shelter-status') {
    throw new ShelterSourceError('shelter status normalizer requires source_id=taiwan-shelter-status', { code: 'STATIC_SOURCE_ID_INVALID' });
  }
  assertRawFeatureSnapshot(rawSnapshot, sourceId, ShelterSourceError);
  const times = staticTimes(rawSnapshot, options, ShelterSourceError);
  const normalizedOptions = { ...options, ...times };
  let unresolvedCount = 0;
  const statusEvents = recordsFromPayload(rawSnapshot.payload)
    .map((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new ShelterSourceError(`shelter status record ${index} must be an object`, { code: 'SHELTER_RECORD_INVALID' });
      }
      if (options.scope !== 'taiwan' && !isNeihuRecord(record)) return undefined;
      const id = shelterId(record, index);
      let geometry;
      try {
        geometry = shelterGeometry(record, index);
      } catch (error) {
        if (['SHELTER_GEOMETRY_MISSING', 'STATIC_SOURCE_GEOMETRY_INVALID'].includes(error.code)) {
          unresolvedCount += 1;
          return undefined;
        }
        throw error;
      }
      if (!isInsideBoundary(geometry, options.boundary, ShelterSourceError)) return undefined;
      const eventVersion = Number(firstValue(
        fieldText(record, '事件版本', '資料版本', '版本', 'event_version', 'version'),
        1,
      ));
      if (!Number.isInteger(eventVersion) || eventVersion < 1) {
        throw new ShelterSourceError(`shelter ${id} event version is invalid`, { code: 'SHELTER_EVENT_VERSION_INVALID' });
      }
      return statusEvent({
        rawSnapshot,
        record,
        id,
        geometry,
        issuedAt: normalizedOptions.issuedAt,
        expiresAt: normalizedOptions.expiresAt,
        eventVersion,
        status: statusValue(record) ?? 'UNKNOWN',
        options: normalizedOptions,
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.event_id.localeCompare(right.event_id));
  Object.defineProperty(statusEvents, 'unresolved_count', { value: unresolvedCount, enumerable: false });
  return statusEvents;
}

export function fetchShelters({
  endpoint = process.env.SHELTER_DATA_ENDPOINT ?? DEFAULT_SHELTER_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
} = {}) {
  return fetchStaticText({
    sourceId: 'taipei-shelter',
    endpoint,
    fetchImpl,
    retrievedAt,
    ErrorClass: ShelterSourceError,
  });
}

export function fetchTaiwanShelters({
  endpoint = process.env.SHELTER_DATA_ENDPOINT ?? DEFAULT_SHELTER_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
} = {}) {
  return fetchStaticText({
    sourceId: 'taiwan-shelter',
    endpoint,
    fetchImpl,
    retrievedAt,
    ErrorClass: ShelterSourceError,
  });
}

export async function fetchShelterStatuses({
  endpoint = process.env.SHELTER_STATUS_ENDPOINT ?? DEFAULT_SHELTER_STATUS_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  timeoutMs = 30000,
} = {}) {
  try {
    const result = await requestText(endpoint, {
      fetchImpl,
      timeoutMs,
      headers: { Accept: 'application/xml, text/xml;q=0.9' },
    });
    return makeRawSnapshot({
      sourceId: 'taiwan-shelter-status',
      request: { method: 'GET', url: endpoint, query: {} },
      responseStatus: result.status,
      responseHeaders: result.headers,
      retrievedAt,
      payload: {
        format: 'xml',
        records: parseShelterStatusXml(result.body),
        raw_xml: result.body,
      },
    });
  } catch (error) {
    if (error instanceof ShelterSourceError) throw error;
    throw new ShelterSourceError(`shelter status request failed: ${error.message}`, {
      code: error.code === 'HTTP_ERROR' ? 'SHELTER_HTTP_ERROR' : 'SHELTER_REQUEST_ERROR',
      status: error.status ?? null,
      cause: error,
    });
  }
}
