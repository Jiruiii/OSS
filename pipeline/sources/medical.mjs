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

export const DEFAULT_MEDICAL_ENDPOINT = 'https://data.taipei/api/v1/dataset/04a3d195-ee97-467a-b066-e471ff99d15d?scope=resourceAquire';

export class MedicalSourceError extends Error {
  constructor(message, { code = 'MEDICAL_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MedicalSourceError';
    this.code = code;
    this.status = status;
  }
}

function administrativeArea(record) {
  return fieldText(record, '行政區', '行政區域', '區', 'district', 'District');
}

function medicalId(record, index) {
  const value = firstValue(
    fieldText(record, '機構代碼', '醫療機構代碼', '院所代碼', '代碼', '_id', 'id', 'ID'),
    `${fieldText(record, '機構名稱', '醫療機構名稱', '院所名稱', '名稱', 'name') ?? ''}:${fieldText(record, '地址', '機構地址', 'address') ?? ''}`,
  );
  if (!value) throw new MedicalSourceError(`medical record ${index} has no stable identity`, { code: 'MEDICAL_FEATURE_ID_MISSING' });
  return normalizeId(value, 'medical identity', MedicalSourceError);
}

function medicalGeometry(record, index) {
  const geometry = pointFromFields(
    record,
    MedicalSourceError,
    ['緯度', 'Latitude', 'latitude', 'lat'],
    ['經度', 'Longitude', 'longitude', 'lon', 'lng'],
  );
  if (!geometry) throw new MedicalSourceError(`medical record ${index} has no coordinate`, { code: 'MEDICAL_GEOMETRY_MISSING' });
  return geometry;
}

function isNeihuRecord(record) {
  const area = administrativeArea(record);
  const address = fieldText(record, '地址', '機構地址', 'address');
  return /內湖區/u.test(`${area ?? ''} ${address ?? ''}`);
}

function medicalFeatureType(category) {
  if (/(?:醫院|hospital)/iu.test(category ?? '')) return 'HOSPITAL';
  if (/(?:診所|clinic)/iu.test(category ?? '')) return 'CLINIC';
  return 'MEDICAL_FACILITY';
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

function normalizeMedicalRecord(record, index, rawSnapshot, options) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new MedicalSourceError(`medical record ${index} must be an object`, { code: 'MEDICAL_RECORD_INVALID' });
  }
  if (!isNeihuRecord(record)) return undefined;
  const id = medicalId(record, index);
  const geometry = medicalGeometry(record, index);
  if (!isInsideNeihu(geometry, options.boundary, MedicalSourceError)) return undefined;
  const name = fieldText(record, '機構名稱', '醫療機構名稱', '院所名稱', '名稱', 'name');
  const address = fieldText(record, '地址', '機構地址', 'address');
  const category = fieldText(record, '分類', '機構類別', '醫療類別', 'category', 'type');
  return featureBase({
    datasetId: options.datasetId,
    layerId: 'medical',
    featureId: `medical:${id}`,
    featureType: medicalFeatureType(category),
    geometry,
    properties: {
      name: name ?? null,
      address: address ?? null,
      administrative_area: administrativeArea(record) ?? null,
      facility_type: category ?? null,
      source_record: record,
    },
    source: 'taipei-medical',
    sourceVersion: sourceVersion(rawSnapshot, record, id),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    options,
    originalSource: rawSnapshot.request.url,
  });
}

export function normalizeMedicalFacilities(rawSnapshot, options = {}) {
  if (!options.boundary) throw new MedicalSourceError('Neihu boundary is required for medical curation', { code: 'MEDICAL_BOUNDARY_MISSING' });
  assertRawFeatureSnapshot(rawSnapshot, 'taipei-medical', MedicalSourceError);
  const times = staticTimes(rawSnapshot, options, MedicalSourceError);
  const normalizedOptions = { ...options, ...times };
  return recordsFromPayload(rawSnapshot.payload)
    .map((record, index) => normalizeMedicalRecord(record, index, rawSnapshot, normalizedOptions))
    .filter(Boolean)
    .sort((left, right) => left.feature_id.localeCompare(right.feature_id));
}

export function fetchMedicalFacilities({
  endpoint = process.env.MEDICAL_DATA_ENDPOINT ?? DEFAULT_MEDICAL_ENDPOINT,
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  limit = 1000,
  offset = 0,
} = {}) {
  return fetchStaticText({
    sourceId: 'taipei-medical',
    endpoint,
    query: { limit, offset },
    fetchImpl,
    retrievedAt,
    ErrorClass: MedicalSourceError,
  });
}
