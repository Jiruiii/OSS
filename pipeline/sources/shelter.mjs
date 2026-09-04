import {
  assertRawFeatureSnapshot,
  featureBase,
  fetchStaticText,
  fieldText,
  firstValue,
  isInsideNeihu,
  normalizeId,
  pointFromFields,
  recordsFromPayload,
  staticTimes,
} from '../lib/feature-source.mjs';

export const DEFAULT_SHELTER_ENDPOINT = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/ED6CF735-6C03-4573-A882-72C1BEC799CB/resource/54550E2F-4567-4C8F-BD2E-E54E9D0386B8/download';

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
  return fieldText(
    record,
    '縣市及鄉鎮市區',
    '縣市鄉鎮市區',
    '行政區',
    '行政區域',
    'area',
    'district',
  );
}

function isNeihuRecord(record) {
  const area = administrativeArea(record);
  const address = fieldText(record, '避難收容處所地址', '地址', 'address');
  return /(?:臺北|台北)市?\s*內湖區/u.test(`${area ?? ''} ${address ?? ''}`)
    || /內湖區/u.test(area ?? '')
    || /內湖區/u.test(address ?? '');
}

function disasterTypes(record) {
  const value = fieldText(record, '適用災害類別', '災害類別', 'disaster_type', 'disaster_types');
  if (value === undefined) return [];
  return value.split(/[;,、，|/]+/u).map((item) => item.trim()).filter(Boolean);
}

function shelterId(record, index) {
  const value = firstValue(
    fieldText(record, '序號', '編號', '避難收容處所編號', '收容所編號', 'id', 'ID'),
    `${fieldText(record, '避難收容處所名稱', '收容所名稱', '名稱', 'name') ?? ''}:${fieldText(record, '避難收容處所地址', '地址', 'address') ?? ''}`,
  );
  if (!value) throw new ShelterSourceError(`shelter record ${index} has no stable identity`, { code: 'SHELTER_FEATURE_ID_MISSING' });
  return normalizeId(value, 'shelter identity', ShelterSourceError);
}

function shelterGeometry(record, index) {
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
    fieldText(record, '開設狀態', '開設情形', '開設狀況', '收容所狀態', 'status', 'Status'),
  );
  if (value === undefined) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (/FULL|滿|額滿/u.test(raw)) return 'FULL';
  if (/CLOSED|關閉|未開設|停用/u.test(raw)) return 'CLOSED';
  if (/OPEN|開設|啟用|可用/u.test(raw)) return 'OPEN';
  return 'UNKNOWN';
}

function statusEvent({ rawSnapshot, record, id, geometry, issuedAt, expiresAt, eventVersion, status, options }) {
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
      area_id: 'neihu',
      theme: 'shelter',
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
  if (!isNeihuRecord(record)) return undefined;
  const id = shelterId(record, index);
  const geometry = shelterGeometry(record, index);
  if (!isInsideNeihu(geometry, options.boundary, ShelterSourceError)) return undefined;
  const name = fieldText(record, '避難收容處所名稱', '收容所名稱', '名稱', 'name');
  const address = fieldText(record, '避難收容處所地址', '地址', 'address');
  const capacity = Number(firstValue(fieldText(record, '預計收容人數', '收容人數', 'capacity'), ''));
  const properties = {
    name: name ?? null,
    address: address ?? null,
    capacity: Number.isFinite(capacity) ? capacity : null,
    disaster_types: disasterTypes(record),
    administrative_area: administrativeArea(record) ?? null,
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
    source: 'taipei-shelter',
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
  if (!options.boundary) throw new ShelterSourceError('Neihu boundary is required for shelter curation', { code: 'SHELTER_BOUNDARY_MISSING' });
  assertRawFeatureSnapshot(rawSnapshot, 'taipei-shelter', ShelterSourceError);
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
