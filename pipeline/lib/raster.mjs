const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const IDENTIFIER_RE = /^[a-z][a-z0-9._:-]{0,127}$/u;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/iu;
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/iu;
const CRS_RE = /^(?:NONE|EPSG:(?:4326|3826|3857))$/u;
const FORMATS = new Set(['CSV', 'GeoTIFF', 'Cloud Optimized GeoTIFF', 'NetCDF', 'STAC JSON']);
const ACCESS_MODES = new Set(['scheduled_download', 'live_api', 'metadata_only']);
const ARTIFACT_STATUSES = new Set(['downloaded', 'metadata_only']);
const STAGES = new Set(['P2', 'P3']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timeError(value, field) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || Number.isNaN(Date.parse(value))) {
    return `${field} must be an RFC 3339 date-time`;
  }
  return undefined;
}

function bboxErrors(value, field) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return [`${field} must be [minLon, minLat, maxLon, maxLat]`];
  }
  const [minLon, minLat, maxLon, maxLat] = value;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return [`${field} is outside WGS84 bounds`];
  if (minLon > maxLon || minLat > maxLat) return [`${field} min corner must not exceed max corner`];
  return [];
}

function urlError(value, field) {
  return typeof value === 'string' && HTTP_URL_RE.test(value) ? undefined : `${field} must be an HTTP(S) URL`;
}

function temporalExtentErrors(value) {
  if (!isObject(value)) return ['temporal_extent must be an object'];
  if (value.kind) {
    if (typeof value.kind !== 'string' || value.kind.length === 0) return ['temporal_extent.kind is invalid'];
    if (typeof value.value !== 'string' || value.value.length === 0) return ['temporal_extent.value is required'];
    return [];
  }
  const errors = [];
  const startError = timeError(value.start, 'temporal_extent.start');
  const endError = timeError(value.end, 'temporal_extent.end');
  if (startError) errors.push(startError);
  if (endError) errors.push(endError);
  if (!startError && !endError && Date.parse(value.end) < Date.parse(value.start)) errors.push('temporal_extent.end must not precede start');
  return errors;
}

function hashErrors(entry) {
  if (!Object.prototype.hasOwnProperty.call(entry, 'file_hash')) return ['file_hash is required; use null only for metadata_only'];
  if (entry.artifact_status === 'metadata_only') {
    if (entry.file_hash !== null && !SHA256_RE.test(String(entry.file_hash))) return ['file_hash must be sha256:<64 hex characters> or null'];
  } else if (typeof entry.file_hash !== 'string' || !SHA256_RE.test(entry.file_hash)) {
    return ['file_hash must be sha256:<64 hex characters> for downloaded artifacts'];
  }
  if (entry.file_hash_algorithm !== 'SHA-256') return ['file_hash_algorithm must be SHA-256'];
  return [];
}

export function validateRasterCatalogEntry(entry) {
  if (!isObject(entry)) return ['entry must be an object'];
  const errors = [];
  for (const field of ['source_id', 'category', 'data_product', 'layer_id', 'source_owner', 'source_url', 'access_path', 'access_mode', 'artifact_status', 'format', 'crs', 'spatial_extent', 'temporal_extent', 'update_mode', 'access_restriction', 'license', 'file_hash', 'file_hash_algorithm', 'raw_or_derived', 'intended_use', 'derived_analysis_not_included', 'limitation', 'integration_stage']) {
    if (!(field in entry)) errors.push(`missing ${field}`);
  }
  for (const field of ['source_id', 'layer_id']) {
    if (typeof entry[field] !== 'string' || !IDENTIFIER_RE.test(entry[field])) errors.push(`${field} is invalid`);
  }
  if (urlError(entry.source_url, 'source_url')) errors.push(urlError(entry.source_url, 'source_url'));
  if (entry.documentation_url !== undefined && urlError(entry.documentation_url, 'documentation_url')) errors.push(urlError(entry.documentation_url, 'documentation_url'));
  if (!ACCESS_MODES.has(entry.access_mode)) errors.push('access_mode is invalid');
  if (!ARTIFACT_STATUSES.has(entry.artifact_status)) errors.push('artifact_status is invalid');
  if (!FORMATS.has(entry.format)) errors.push('format is unsupported');
  if (typeof entry.crs !== 'string' || !CRS_RE.test(entry.crs)) errors.push('crs is invalid');
  if (!isObject(entry.spatial_extent)) errors.push('spatial_extent is required');
  else errors.push(...bboxErrors(entry.spatial_extent.bbox, 'spatial_extent.bbox'));
  errors.push(...temporalExtentErrors(entry.temporal_extent));
  if (typeof entry.update_mode !== 'string' || entry.update_mode.trim() === '') errors.push('update_mode is required');
  if (typeof entry.access_restriction !== 'string' || entry.access_restriction.trim() === '') errors.push('access_restriction is required');
  if (typeof entry.license !== 'string' || entry.license.trim() === '') errors.push('license is required');
  if (entry.raw_or_derived !== 'raw') errors.push('raw_or_derived must be raw');
  for (const field of ['intended_use', 'derived_analysis_not_included']) {
    if (!Array.isArray(entry[field]) || entry[field].length === 0 || entry[field].some((item) => typeof item !== 'string' || item.trim() === '')) {
      errors.push(`${field} must be a non-empty string array`);
    }
  }
  if (typeof entry.limitation !== 'string' || entry.limitation.trim() === '') errors.push('limitation is required');
  if (!STAGES.has(entry.integration_stage)) errors.push('integration_stage must be P2 or P3');
  errors.push(...hashErrors(entry));
  return errors;
}

function artifactErrors(metadata) {
  const errors = [];
  for (const field of ['source_id', 'layer_id', 'format', 'crs', 'bbox', 'retrieved_at', 'expires_at', 'file_hash', 'file_hash_algorithm', 'access_mode', 'artifact_status']) {
    if (!(field in metadata)) errors.push(`missing ${field}`);
  }
  if (typeof metadata.source_id !== 'string' || !IDENTIFIER_RE.test(metadata.source_id)) errors.push('source_id is invalid');
  if (typeof metadata.layer_id !== 'string' || !IDENTIFIER_RE.test(metadata.layer_id)) errors.push('layer_id is invalid');
  if (!FORMATS.has(metadata.format)) errors.push('format is unsupported');
  if (typeof metadata.crs !== 'string' || !CRS_RE.test(metadata.crs)) errors.push('crs is invalid');
  errors.push(...bboxErrors(metadata.bbox, 'bbox'));
  const retrievedError = timeError(metadata.retrieved_at, 'retrieved_at');
  const expiresError = timeError(metadata.expires_at, 'expires_at');
  if (retrievedError) errors.push(retrievedError);
  if (expiresError) errors.push(expiresError);
  if (!retrievedError && !expiresError && Date.parse(metadata.expires_at) < Date.parse(metadata.retrieved_at)) errors.push('expires_at must not precede retrieved_at');
  if (!ACCESS_MODES.has(metadata.access_mode)) errors.push('access_mode is invalid');
  if (!ARTIFACT_STATUSES.has(metadata.artifact_status)) errors.push('artifact_status is invalid');
  errors.push(...hashErrors(metadata));
  return errors;
}

export function makeRasterArtifactMetadata({
  sourceId,
  datasetId = 'resilientgeo-neihu',
  layerId,
  sourceUrl = null,
  format,
  crs,
  bbox,
  retrievedAt,
  expiresAt,
  fileHash,
  accessMode,
  artifactStatus = fileHash ? 'downloaded' : 'metadata_only',
  intendedUse = [],
  limitation = 'Artifact processing and derived risk analysis are not included in this metadata record.',
} = {}) {
  const metadata = {
    schema_version: 'raster-artifact-metadata-v0',
    artifact_id: `${sourceId ?? 'unknown'}:${layerId ?? 'unknown'}:${retrievedAt ?? 'unknown'}`,
    source_id: sourceId,
    dataset_id: datasetId,
    layer_id: layerId,
    source_url: sourceUrl,
    artifact_status: artifactStatus,
    format,
    crs,
    bbox,
    bbox_crs: 'EPSG:4326',
    retrieved_at: retrievedAt,
    expires_at: expiresAt,
    file_hash: fileHash,
    file_hash_algorithm: 'SHA-256',
    access_mode: accessMode,
    raw_or_derived: 'raw',
    intended_use: intendedUse,
    limitation,
  };
  const errors = artifactErrors(metadata);
  if (errors.length > 0) throw new TypeError(`invalid raster artifact metadata: ${errors.join('; ')}`);
  return metadata;
}
