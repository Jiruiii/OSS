import { isGeometryInBoundary } from './geo.mjs';

/**
 * Resolve the boundary used for a record. A national collector can provide a
 * county/town resolver for records that only contain an administrative name;
 * legacy Neihu callers continue to use the single boundary argument.
 */
export function boundaryForRecord(options = {}, record, geometry) {
  const resolved = options.boundaryResolver?.(record, geometry);
  return resolved ?? options.boundary;
}

export function areaForRecord(options = {}, record, geometry) {
  return options.areaResolver?.(record, geometry);
}

export function areaIdForRecord(options = {}, record, geometry, fallback = 'neihu') {
  const resolved = areaForRecord(options, record, geometry)?.area_id
    ?? options.areaIdResolver?.(record, geometry);
  if (typeof resolved === 'string' && resolved.trim() !== '') return resolved;
  if (typeof options.areaId === 'string' && options.areaId.trim() !== '') return options.areaId;
  return options.scope === 'taiwan' ? 'tw' : fallback;
}

export function areaMetadataForRecord(options = {}, record, geometry, fallback = 'neihu') {
  const area = areaForRecord(options, record, geometry);
  const metadata = {
    area_id: area?.area_id ?? areaIdForRecord(options, record, geometry, fallback),
  };
  if (options.scope === 'taiwan') {
    return {
      ...metadata,
      county_code: area?.county_code ?? null,
      town_code: area?.town_code ?? null,
      village_code: area?.village_code ?? null,
    };
  }
  return metadata;
}

export function coverageForGeometry(geometry, record, options = {}, {
  geometryLevel = 'district',
  fallbackLevel = 'city',
} = {}) {
  const boundary = boundaryForRecord(options, record, geometry);
  if (geometry && boundary && isGeometryInBoundary(geometry, boundary)) {
    return { geometry, coverageLevel: geometryLevel };
  }
  if (boundary) {
    return {
      geometry: boundary.type === 'Feature' ? boundary.geometry : boundary,
      coverageLevel: fallbackLevel,
    };
  }
  return undefined;
}

export function scopeIncludesGeometry(geometry, record, options = {}) {
  const boundary = boundaryForRecord(options, record, geometry);
  return Boolean(boundary && geometry && isGeometryInBoundary(geometry, boundary));
}
