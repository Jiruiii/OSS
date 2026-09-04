/**
 * Peer Sync v0 protocol engine.
 *
 * This module is transport-agnostic: it only reasons about `peer-summary-v0`
 * documents (see schemas/peer-summary-v0.schema.json) and produces the same
 * DIFF / REQUEST message shapes recorded in
 * fixtures/protocol-exchange-v0.json. BLE / Nearby Connections / Wi-Fi
 * Direct only need to move bytes; this file decides *which* bytes matter.
 */

const PRIORITY_ORDER = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

function priorityRank(priority) {
  const rank = PRIORITY_ORDER.indexOf(priority);
  if (rank === -1) {
    throw new RangeError(`unknown chunk priority: ${priority}`);
  }
  return rank;
}

function findDataset(summary, datasetId, namespace) {
  const dataset = summary.datasets.find(
    (entry) => entry.dataset_id === datasetId && entry.namespace === namespace,
  );
  if (!dataset) {
    throw new RangeError(
      `peer summary for ${summary.node_id} has no dataset ${namespace}/${datasetId}`,
    );
  }
  return dataset;
}

/**
 * Compare what the local node has against what a remote peer advertised in
 * its HELLO, for a single dataset/namespace.
 *
 * - `missing_chunks`: chunk_ids the remote has and the local node does not.
 * - `stale_chunks`: chunk_ids present locally but with a different hash than
 *   the remote's copy, meaning the remote's copy should be treated as the
 *   newer one for this exchange.
 *
 * This intentionally mirrors the DIFF message fields in
 * fixtures/protocol-exchange-v0.json so the fixture can be replayed as a
 * test.
 */
export function computeDiff(localSummary, remoteSummary, { datasetId, namespace }) {
  const localDataset = findDataset(localSummary, datasetId, namespace);
  const remoteDataset = findDataset(remoteSummary, datasetId, namespace);

  if (localDataset.manifest_id !== remoteDataset.manifest_id) {
    throw new RangeError(
      `manifest mismatch for ${namespace}/${datasetId}: `
      + `local=${localDataset.manifest_id} remote=${remoteDataset.manifest_id}`,
    );
  }

  const localChunksById = new Map(
    localDataset.chunks.map((chunk) => [chunk.chunk_id, chunk]),
  );

  const missingChunks = [];
  const staleChunks = [];

  for (const remoteChunk of remoteDataset.chunks) {
    const localChunk = localChunksById.get(remoteChunk.chunk_id);
    if (!localChunk) {
      missingChunks.push({
        chunk_id: remoteChunk.chunk_id,
        chunk_hash: remoteChunk.chunk_hash,
        size_bytes: remoteChunk.size_bytes,
        priority: remoteChunk.priority,
      });
    } else if (localChunk.chunk_hash !== remoteChunk.chunk_hash) {
      staleChunks.push({
        chunk_id: remoteChunk.chunk_id,
        chunk_hash: remoteChunk.chunk_hash,
        size_bytes: remoteChunk.size_bytes,
        priority: remoteChunk.priority,
      });
    }
  }

  return {
    dataset_id: datasetId,
    namespace,
    manifest_id: remoteDataset.manifest_id,
    missing_chunks: missingChunks,
    stale_chunks: staleChunks,
  };
}

/**
 * Turn a DIFF result into a REQUEST message body: missing + stale chunks,
 * ordered CRITICAL > HIGH > NORMAL > LOW, then smallest-first within the
 * same priority so cheap wins land before one big transfer blocks everything.
 *
 * v0 always requests from offset 0 — resumable mid-chunk requests are a
 * stage 3 concern once TRANSFER framing exists.
 */
export function buildRequest(diff, { resume = true } = {}) {
  const wanted = [...diff.missing_chunks, ...diff.stale_chunks];

  const chunks = [...wanted]
    .sort((a, b) => {
      const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return a.size_bytes - b.size_bytes;
    })
    .map((chunk) => ({
      chunk_id: chunk.chunk_id,
      chunk_hash: chunk.chunk_hash,
      priority: chunk.priority,
      offset_bytes: 0,
      max_bytes: chunk.size_bytes,
    }));

  const maxTotalBytes = chunks.reduce((sum, chunk) => sum + chunk.max_bytes, 0);

  return {
    dataset_id: diff.dataset_id,
    namespace: diff.namespace,
    manifest_id: diff.manifest_id,
    chunks,
    resume,
    max_total_bytes: maxTotalBytes,
  };
}
