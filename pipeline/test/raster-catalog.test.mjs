import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  makeRasterArtifactMetadata,
  validateRasterCatalogEntry,
} from '../lib/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'pipeline/sources/raster-catalog.json'), 'utf8'));

const VALID_ARTIFACT = {
  sourceId: 'dem-dsm-neihu',
  layerId: 'dem-neihu',
  sourceUrl: 'https://data.gov.tw/dataset/176927',
  format: 'GeoTIFF',
  crs: 'EPSG:3826',
  bbox: [121.5519933, 25.0518603, 121.6286149, 25.1151519],
  retrievedAt: '2026-09-04T04:00:00Z',
  expiresAt: '2027-09-04T04:00:00Z',
  fileHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  accessMode: 'scheduled_download',
};

test('raster catalog contains valid metadata-only entries for all three advanced sources', () => {
  assert.deepEqual(catalog.entries.map((entry) => entry.source_id).sort(), [
    'dem-dsm-neihu',
    'network-neihu',
    'sar-optical-neihu',
  ]);
  for (const entry of catalog.entries) assert.deepEqual(validateRasterCatalogEntry(entry), []);
});

test('creates downloadable raster artifact metadata with a file hash', () => {
  const artifact = makeRasterArtifactMetadata(VALID_ARTIFACT);
  assert.equal(artifact.schema_version, 'raster-artifact-metadata-v0');
  assert.equal(artifact.source_id, VALID_ARTIFACT.sourceId);
  assert.equal(artifact.layer_id, VALID_ARTIFACT.layerId);
  assert.equal(artifact.file_hash, VALID_ARTIFACT.fileHash);
  assert.equal(artifact.raw_or_derived, 'raw');
});

test('allows metadata-only records only with an explicit null file hash', () => {
  const artifact = makeRasterArtifactMetadata({
    ...VALID_ARTIFACT,
    artifactStatus: 'metadata_only',
    fileHash: null,
  });
  assert.equal(artifact.artifact_status, 'metadata_only');
  assert.equal(artifact.file_hash, null);
  assert.equal(artifact.file_hash_algorithm, 'SHA-256');
});

test('rejects missing source URL, unsupported format, invalid CRS, missing hash and invalid bbox', () => {
  const missingUrl = { ...catalog.entries[0] };
  delete missingUrl.source_url;
  assert.ok(validateRasterCatalogEntry(missingUrl).some((error) => error.includes('source_url')));

  const unsupported = { ...catalog.entries[0], format: 'BMP' };
  assert.ok(validateRasterCatalogEntry(unsupported).some((error) => error.includes('format')));

  const invalidCrs = { ...catalog.entries[0], crs: 'EPSG:999999' };
  assert.ok(validateRasterCatalogEntry(invalidCrs).some((error) => error.includes('crs')));

  const missingHash = { ...catalog.entries[0], artifact_status: 'downloaded', file_hash: null };
  assert.ok(validateRasterCatalogEntry(missingHash).some((error) => error.includes('file_hash')));

  const invalidBbox = { ...catalog.entries[0], spatial_extent: { bbox: [121, 25, 120, 26] } };
  assert.ok(validateRasterCatalogEntry(invalidBbox).some((error) => error.includes('bbox')));
});

test('rejects artifact expiry before retrieval and invalid artifact hash', () => {
  assert.throws(
    () => makeRasterArtifactMetadata({ ...VALID_ARTIFACT, expiresAt: '2026-09-03T04:00:00Z' }),
    /expires_at/u,
  );
  assert.throws(
    () => makeRasterArtifactMetadata({ ...VALID_ARTIFACT, fileHash: 'not-a-sha256' }),
    /file_hash/u,
  );
});

test('requires a limitation and keeps raster/network source stages in P2 or P3', () => {
  for (const entry of catalog.entries) {
    assert.ok(['P2', 'P3'].includes(entry.integration_stage));
    assert.equal(typeof entry.limitation, 'string');
    assert.ok(entry.limitation.trim().length > 0);
  }
  const invalid = { ...catalog.entries[0], limitation: '' };
  assert.ok(validateRasterCatalogEntry(invalid).some((error) => error.includes('limitation')));
});
