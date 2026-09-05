import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRequest, computeDiff } from '../lib/peer-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(ROOT, 'fixtures', name), 'utf8'));
}

const exchange = loadFixture('protocol-exchange-v0.json');
const peerA = loadFixture(exchange.peer_summaries['node-a']);
const peerB = loadFixture(exchange.peer_summaries['node-b']);

const diffMessage = exchange.messages.find((message) => message.type === 'DIFF');
const requestMessage = exchange.messages.find((message) => message.type === 'REQUEST');

test('computeDiff finds the chunk node-a is missing from node-b', () => {
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });

  assert.equal(diff.manifest_id, diffMessage.manifest_id);
  assert.deepEqual(diff.missing_chunks, diffMessage.missing_chunks);
  assert.deepEqual(diff.stale_chunks, diffMessage.stale_chunks);

  assert.deepEqual(
    diff.missing_chunks.map((chunk) => chunk.chunk_id),
    exchange.expected.a_missing_chunks_before_sync,
  );
});

test('buildRequest matches the fixture REQUEST message', () => {
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });
  const request = buildRequest(diff, { resume: requestMessage.resume });

  assert.deepEqual(request.chunks, requestMessage.chunks);
  assert.equal(request.max_total_bytes, requestMessage.max_total_bytes);
  assert.equal(request.resume, requestMessage.resume);
});

test('after applying the request, node-a is missing nothing', () => {
  // Simulate APPLY: node-a merges every requested chunk into its own summary.
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });
  const merged = new Map(
    peerA.datasets[0].chunks.map((chunk) => [chunk.chunk_id, chunk]),
  );
  for (const chunk of diff.missing_chunks) {
    merged.set(chunk.chunk_id, chunk);
  }

  const peerAAfterSync = {
    ...peerA,
    datasets: [{ ...peerA.datasets[0], chunks: [...merged.values()] }],
  };
  const diffAfterSync = computeDiff(peerAAfterSync, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });

  assert.deepEqual(
    diffAfterSync.missing_chunks.map((chunk) => chunk.chunk_id),
    exchange.expected.a_missing_chunks_after_sync,
  );
});

test('computeDiff rejects two manifests that both claim the same dataset_version', () => {
  const peerBWrongManifest = {
    ...peerB,
    datasets: [{ ...peerB.datasets[0], manifest_id: 'demo:official:999' }],
  };

  assert.throws(
    () => computeDiff(peerA, peerBWrongManifest, {
      datasetId: diffMessage.dataset_id,
      namespace: diffMessage.namespace,
    }),
    /manifest mismatch/,
  );
});

test('computeDiff treats a peer carrying a newer manifest_id as a DTN supersession, not an error', () => {
  // A walks into a shelter carrying v137; everyone there (peerB) is still on
  // v136. This is the exact scenario opportunistic contact exists for, so it
  // must produce a REQUEST instead of throwing.
  const peerNewerManifest = {
    ...peerA,
    datasets: [{
      ...peerA.datasets[0],
      manifest_id: 'resilientgeo-demo:manifest:137',
      manifest_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      dataset_version: 137,
      chunks: [
        {
          chunk_id: 'resilientgeo-demo:chunk:137:dahu:road:000',
          chunk_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          size_bytes: 512,
          priority: 'CRITICAL',
          state: 'available',
        },
      ],
    }],
  };

  const diff = computeDiff(peerNewerManifest, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });

  // Remote (peerB, v136) has nothing local doesn't already have for this
  // dataset -- local's own newer manifest_id (v137) stays current.
  assert.equal(diff.manifest_id, 'resilientgeo-demo:manifest:137');
  assert.equal(diff.superseded_manifest_id, null);
  assert.deepEqual(diff.missing_chunks, []);
  assert.deepEqual(diff.stale_chunks, []);
});

test('computeDiff requests every chunk from a peer carrying a newer manifest_id', () => {
  const peerBNewerManifest = {
    ...peerB,
    datasets: [{
      ...peerB.datasets[0],
      manifest_id: 'resilientgeo-demo:manifest:137',
      manifest_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      dataset_version: 137,
      chunks: [
        {
          chunk_id: 'resilientgeo-demo:chunk:137:dahu:road:000',
          chunk_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          size_bytes: 512,
          priority: 'CRITICAL',
          state: 'available',
        },
      ],
    }],
  };

  const diff = computeDiff(peerA, peerBNewerManifest, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });

  assert.equal(diff.manifest_id, 'resilientgeo-demo:manifest:137');
  assert.equal(diff.superseded_manifest_id, 'resilientgeo-demo:manifest:136');
  assert.deepEqual(diff.stale_chunks, []);
  assert.deepEqual(
    diff.missing_chunks.map((chunk) => chunk.chunk_id),
    ['resilientgeo-demo:chunk:137:dahu:road:000'],
  );

  const request = buildRequest(diff);
  assert.equal(request.superseded_manifest_id, 'resilientgeo-demo:manifest:136');
});

test('buildRequest resumes from a per-chunk byte offset instead of restarting at 0', () => {
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });
  const target = diff.missing_chunks[0];

  const fresh = buildRequest(diff);
  assert.equal(fresh.chunks[0].offset_bytes, 0);
  assert.equal(fresh.chunks[0].max_bytes, target.size_bytes);

  // Same DIFF, but this node already holds the first 400 bytes from an
  // earlier contact that was cut short. Without this, every contact would
  // re-request the whole chunk and never finish it at BLE throughput.
  const resumed = buildRequest(diff, { offsets: { [target.chunk_id]: 400 } });
  assert.equal(resumed.chunks[0].offset_bytes, 400);
  assert.equal(resumed.chunks[0].max_bytes, target.size_bytes - 400);
  assert.equal(resumed.max_total_bytes, target.size_bytes - 400);
});

test('buildRequest drops a chunk that is already fully held', () => {
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });
  const target = diff.missing_chunks[0];

  const request = buildRequest(diff, { offsets: { [target.chunk_id]: target.size_bytes } });
  assert.deepEqual(request.chunks.map((chunk) => chunk.chunk_id), []);
  assert.equal(request.max_total_bytes, 0);
});

test('buildRequest rejects an offset past the end of the chunk', () => {
  const diff = computeDiff(peerA, peerB, {
    datasetId: diffMessage.dataset_id,
    namespace: diffMessage.namespace,
  });
  const target = diff.missing_chunks[0];

  assert.throws(
    () => buildRequest(diff, { offsets: { [target.chunk_id]: target.size_bytes + 1 } }),
    RangeError,
  );
  assert.throws(() => buildRequest(diff, { offsets: { [target.chunk_id]: -1 } }), RangeError);
});
