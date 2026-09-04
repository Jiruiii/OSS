/**
 * Geometry helpers for area-aware chunking.
 *
 * A bbox is always `[minLon, minLat, maxLon, maxLat]` in WGS84 degrees, matching
 * the `[longitude, latitude]` coordinate order fixed by the v0 data contract.
 * Values are derived from event geometry only, never hand-entered, so a receiver
 * can recompute and verify them.
 */

const BBOX_PRECISION = 6;

function round(value) {
  return Number(value.toFixed(BBOX_PRECISION));
}

function extendFromCoordinates(box, coordinates) {
  if (typeof coordinates[0] === 'number') {
    const [lon, lat] = coordinates;
    if (lon < box[0]) box[0] = lon;
    if (lat < box[1]) box[1] = lat;
    if (lon > box[2]) box[2] = lon;
    if (lat > box[3]) box[3] = lat;
    return;
  }
  for (const child of coordinates) extendFromCoordinates(box, child);
}

function extendFromGeometry(box, geometry) {
  if (!geometry || typeof geometry.type !== 'string') {
    throw new TypeError('cannot compute a bbox for a non-geometry value');
  }
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries) || geometry.geometries.length === 0) {
      throw new TypeError('GeometryCollection needs a non-empty geometries array');
    }
    for (const child of geometry.geometries) extendFromGeometry(box, child);
    return;
  }
  if (!Array.isArray(geometry.coordinates)) {
    throw new TypeError(`geometry ${geometry.type} needs a coordinates array`);
  }
  extendFromCoordinates(box, geometry.coordinates);
}

export function bboxOfGeometry(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  extendFromGeometry(box, geometry);
  if (!box.every(Number.isFinite)) throw new TypeError('geometry produced an empty bbox');
  return box.map(round);
}

export function bboxOfEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('bboxOfEvents requires a non-empty events array');
  }
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const event of events) extendFromGeometry(box, event.geometry);
  if (!box.every(Number.isFinite)) throw new TypeError('events produced an empty bbox');
  return box.map(round);
}

export function bboxContains(outer, inner) {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}

export function bboxIntersects(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
