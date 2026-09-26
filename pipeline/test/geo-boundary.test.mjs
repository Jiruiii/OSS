import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isGeometryInBoundary } from '../lib/geo.mjs';

// A county-scale ring: far more vertices than Math.min(...spread) can take.
function denseSquare(minX, minY, size, perSide) {
  const ring = [];
  for (let i = 0; i < perSide; i += 1) ring.push([minX + (size * i) / perSide, minY]);
  for (let i = 0; i < perSide; i += 1) ring.push([minX + size, minY + (size * i) / perSide]);
  for (let i = 0; i < perSide; i += 1) ring.push([minX + size - (size * i) / perSide, minY + size]);
  for (let i = 0; i < perSide; i += 1) ring.push([minX, minY + size - (size * i) / perSide]);
  ring.push([minX, minY]);
  return { type: 'Polygon', coordinates: [ring] };
}

test('dense boundaries do not overflow and repeated lookups stay fast', () => {
  const boundary = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: denseSquare(121.0, 25.0, 0.1, 100_000) },
      { type: 'Feature', properties: {}, geometry: denseSquare(120.0, 23.0, 0.1, 100_000) },
    ],
  };
  const started = Date.now();
  let inside = 0;
  for (let i = 0; i < 2_000; i += 1) {
    if (isGeometryInBoundary({ type: 'Point', coordinates: [121.05, 25.05] }, boundary)) inside += 1;
    // Outside every envelope: must be rejected without walking any ring.
    assert.equal(isGeometryInBoundary({ type: 'Point', coordinates: [119.0, 22.0] }, boundary), false);
  }
  assert.equal(inside, 2_000);
  assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
});

test('non-point geometries still use envelope intersection', () => {
  const boundary = denseSquare(121.0, 25.0, 0.1, 10);
  const line = { type: 'LineString', coordinates: [[120.9, 25.05], [121.05, 25.05]] };
  const far = { type: 'LineString', coordinates: [[119.0, 22.0], [119.1, 22.1]] };
  assert.equal(isGeometryInBoundary(line, boundary), true);
  assert.equal(isGeometryInBoundary(far, boundary), false);
});
