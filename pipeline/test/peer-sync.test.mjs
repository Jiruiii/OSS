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

test('computeDiff rejects mismatched manifests instead of guessing', () => {
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
