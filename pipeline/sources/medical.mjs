import {
  assertRawFeatureSnapshot,
  featureBase,
  fetchStaticBinary,
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

// data.gov.tw dataset 15393 currently links to this MOHW ODS resource. The
// annual file URL can change; override MEDICAL_DATA_ENDPOINT after the source
// page publishes a new resource. JSON/CSV mirrors remain supported.
export const DEFAULT_MEDICAL_ENDPOINT = 'https://www.mohw.gov.tw/dl-96581-66dbb751-f83a-416a-a998-893222e20fef.html';
export const DEFAULT_MEDICAL_FORMAT = 'ods';

export class MedicalSourceError extends Error {
  constructor(message, { code = 'MEDICAL_SOURCE_ERROR', status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MedicalSourceError';
    this.code = code;
    this.status = status;
  }
}

function administrativeArea(record) {
  return fieldText(record, '行政區', '行政區域', '縣市鄉鎮', '縣市區名', '區', 'district', 'District');
}

function medicalId(record, index) {
  const value = firstValue(
    fieldText(record, '機構代碼', '醫療機構代碼', '院所代碼', '醫事機構代碼', '代碼', '_id', 'id', 'ID'),
    `${fieldText(record, '機構名稱', '醫療機構名稱', '院所名稱', '醫事機構名稱', '名稱', 'name') ?? ''}:${fieldText(record, '地址', '機構地址', '醫事機構地址', 'address') ?? ''}`,
  );
  if (!value) throw new MedicalSourceError(`medical record ${index} has no stable identity`, { code: 'MEDICAL_FEATURE_ID_MISSING' });
  return normalizeId(value, 'medical identity', MedicalSourceError);
}

function medicalGeometry(record, index) {
  const geometry = pointFromFields(
    record,
    MedicalSourceError,
    ['緯度', 'Latitude', 'latitude', 'lat', '緯度(WGS84)'],
    ['經度', 'Longitude', 'longitude', 'lon', 'lng', '經度(WGS84)'],
  );
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
  if (options.scope !== 'taiwan' && !isNeihuRecord(record)) return undefined;
  const id = medicalId(record, index);
  const geometry = medicalGeometry(record, index);
  const name = fieldText(record, '機構名稱', '醫療機構名稱', '院所名稱', '醫事機構名稱', '名稱', 'name');
  const address = fieldText(record, '地址', '機構地址', '醫事機構地址', 'address');
  const phone = fieldText(record, '電話', '聯絡電話', '機構電話', '電話號碼', 'phone', 'telephone');
  const category = fieldText(record, '分類', '機構類別', '醫療類別', '醫事機構種類', '科別', 'department', 'departments', 'category', 'type');
  if (!geometry) {
    if (options.allowUnresolved) {
      return {
        unresolved: {
          medical_id: id,
          name: name ?? null,
          address: address ?? null,
          geometry_status: 'unresolved',
          source_record: record,
        },
      };
    }
    throw new MedicalSourceError(`medical record ${index} has no coordinate`, { code: 'MEDICAL_GEOMETRY_MISSING' });
  }
  if (!isInsideBoundary(geometry, options.boundary, MedicalSourceError)) return undefined;
  const area = areaMetadataForRecord(options, record, geometry);
  return featureBase({
    datasetId: options.datasetId,
    layerId: 'medical',
    featureId: `medical:${id}`,
    featureType: medicalFeatureType(category),
    geometry,
    properties: {
      name: name ?? null,
      address: address ?? null,
      phone: phone ?? null,
      departments: category ?? null,
      administrative_area: administrativeArea(record) ?? null,
      facility_type: category ?? null,
      ...area,
      ...(options.coverage ? { coverage: options.coverage } : {}),
      source_record: record,
    },
    source: options.sourceId ?? rawSnapshot.source_id,
    sourceVersion: sourceVersion(rawSnapshot, record, id),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    options,
    originalSource: rawSnapshot.request.url,
  });
}

export function normalizeMedicalFacilities(rawSnapshot, options = {}) {
  return normalizeMedicalFacilitiesReport(rawSnapshot, {
    ...options,
    allowUnresolved: false,
  }).features;
}

export function normalizeMedicalFacilitiesReport(rawSnapshot, options = {}) {
  if (!options.boundary) throw new MedicalSourceError('Medical scope boundary is required for curation', { code: 'MEDICAL_BOUNDARY_MISSING' });
  const sourceId = options.sourceId ?? rawSnapshot.source_id;
  if (!['taipei-medical', 'taiwan-medical'].includes(sourceId)) {
    throw new MedicalSourceError('medical normalizer requires source_id=taipei-medical or taiwan-medical', { code: 'STATIC_SOURCE_ID_INVALID' });
  }
  assertRawFeatureSnapshot(rawSnapshot, sourceId, MedicalSourceError);
  const times = staticTimes(rawSnapshot, options, MedicalSourceError);
  const normalizedOptions = {
    ...options,
    ...times,
    allowUnresolved: options.allowUnresolved ?? true,
  };
  const results = recordsFromPayload(rawSnapshot.payload)
    .map((record, index) => normalizeMedicalRecord(record, index, rawSnapshot, normalizedOptions))
    .filter(Boolean);
  return {
    features: results
      .filter((result) => !result.unresolved)
      .sort((left, right) => left.feature_id.localeCompare(right.feature_id)),
    unresolved: results
      .filter((result) => result.unresolved)
      .map((result) => result.unresolved),
  };
}

function comparableText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replaceAll('台', '臺');
}

function coordinateFeatureText(feature) {
  const properties = feature?.properties ?? {};
  const tags = properties.tags ?? {};
  return {
    name: comparableText(firstValue(properties.name, tags.name)),
    address: comparableText(firstValue(properties.address, tags['addr:full'], tags['addr:street'])),
  };
}

function medicalMatchScore(unresolved, candidate) {
  const left = {
    name: comparableText(unresolved.name),
    address: comparableText(unresolved.address),
  };
  const right = coordinateFeatureText(candidate);
  if (!left.name || !right.name || left.name !== right.name) return 0;
  if (left.address && right.address && (left.address.includes(right.address) || right.address.includes(left.address))) return 2;
  return 1;
}

export function mergeMedicalCoordinates(report, coordinateFeatures, options = {}) {
  if (!report || !Array.isArray(report.features) || !Array.isArray(report.unresolved)) {
    throw new MedicalSourceError('medical coordinate supplement requires a medical normalization report', { code: 'MEDICAL_REPORT_INVALID' });
  }
  if (!Array.isArray(coordinateFeatures)) {
    throw new MedicalSourceError('medical coordinate supplement requires a feature array', { code: 'MEDICAL_COORDINATE_INPUT_INVALID' });
  }
  if (!options.rawSnapshot) {
    throw new MedicalSourceError('medical coordinate supplement requires the original Raw snapshot', { code: 'MEDICAL_RAW_REQUIRED' });
  }
  const times = staticTimes(options.rawSnapshot, options, MedicalSourceError);
  const normalizedOptions = {
    ...options,
    ...times,
    allowUnresolved: false,
  };
  const supplemented = [];
  const remaining = [];
  for (const unresolved of report.unresolved) {
    const candidates = coordinateFeatures
      .filter((feature) => feature?.geometry?.type === 'Point')
      .map((feature) => ({ feature, score: medicalMatchScore(unresolved, feature) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    const topScore = candidates[0]?.score ?? 0;
    const topCount = candidates.filter((entry) => entry.score === topScore).length;
    if (topScore === 0 || topCount !== 1) {
      remaining.push(unresolved);
      continue;
    }
    const geometry = candidates[0].feature.geometry;
    const [longitude, latitude] = geometry.coordinates;
    const record = {
      ...unresolved.source_record,
      經度: String(longitude),
      緯度: String(latitude),
    };
    const feature = normalizeMedicalRecord(record, -1, options.rawSnapshot, normalizedOptions);
    if (!feature || feature.unresolved) {
      remaining.push(unresolved);
      continue;
    }
    feature.properties.coordinate_source = options.coordinateSource ?? 'OSM';
    supplemented.push(feature);
  }
  return {
    features: [...report.features, ...supplemented].sort((left, right) => left.feature_id.localeCompare(right.feature_id)),
    unresolved: remaining,
    supplemented_count: supplemented.length,
  };
}

export function fetchMedicalFacilities({
  sourceId = process.env.MEDICAL_SOURCE_ID ?? 'taiwan-medical',
  endpoint = process.env.MEDICAL_DATA_ENDPOINT ?? DEFAULT_MEDICAL_ENDPOINT,
  format = process.env.MEDICAL_DATA_FORMAT ?? (endpoint === DEFAULT_MEDICAL_ENDPOINT ? DEFAULT_MEDICAL_FORMAT : 'json'),
  fetchImpl = globalThis.fetch,
  retrievedAt = new Date().toISOString(),
  limit = 1000,
  offset = 0,
} = {}) {
  if (format.toLowerCase() === 'ods') {
    return fetchStaticBinary({
      sourceId,
      endpoint,
      fetchImpl,
      retrievedAt,
      ErrorClass: MedicalSourceError,
      format: 'ods',
    });
  }
  return fetchStaticText({
    sourceId,
    endpoint,
    query: { limit, offset },
    fetchImpl,
    retrievedAt,
    ErrorClass: MedicalSourceError,
  });
}
