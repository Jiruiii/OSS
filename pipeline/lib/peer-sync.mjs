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
    return computeCrossManifestDiff(localDataset, remoteDataset, { datasetId, namespace });
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
    superseded_manifest_id: null,
  };
}

/**
 * DTN-model diff for the case where the peer is carrying a *different*
 * manifest_id for the same dataset — e.g. a node walks into a shelter with
 * v137 while everyone else there is still on v136. This is the exact
 * scenario opportunistic contact is meant to serve, so it must not be a
 * hard error (see docs/peer-sync-v0.md "跨 manifest_id 的 DIFF 行為").
 *
 * v0 rule: the strictly newer dataset_version wins wholesale for this
 * dataset. This is *not* a byte-identical chunk diff against the old
 * manifest — `chunk_id`/`chunk_hash` are not stable across dataset_version
 * under fixed-size chunking (an edit anywhere in a group shifts every later
 * chunk boundary in that group), so there is no reliable way to tell
 * "unchanged since last manifest" from the chunk_id list alone. Matching by
 * chunk_hash still dedupes the rare case where a chunk happens to be
 * byte-identical across versions. Event-level (namespace, event_id,
 * event_version) diffing would be more precise but needs granularity the
 * HELLO summary deliberately does not carry (see C3 in the same doc) --
 * left as a v0.1 extension, not implemented here.
 */
function computeCrossManifestDiff(localDataset, remoteDataset, { datasetId, namespace }) {
  if (remoteDataset.dataset_version === localDataset.dataset_version) {
    throw new RangeError(
      `manifest mismatch for ${namespace}/${datasetId}: `
      + `local=${localDataset.manifest_id} remote=${remoteDataset.manifest_id} `
      + `both claim dataset_version=${localDataset.dataset_version}`,
    );
  }

  if (remoteDataset.dataset_version < localDataset.dataset_version) {
    // Remote is carrying an older manifest lineage for this dataset; there
    // is nothing for the local node to request here (local would instead be
    // the one whose HELLO looks newer to the remote peer).
    return {
      dataset_id: datasetId,
      namespace,
      manifest_id: localDataset.manifest_id,
      missing_chunks: [],
      stale_chunks: [],
      superseded_manifest_id: null,
    };
  }

  const localHashes = new Set(localDataset.chunks.map((chunk) => chunk.chunk_hash));
  const missingChunks = remoteDataset.chunks
    .filter((chunk) => !localHashes.has(chunk.chunk_hash))
    .map((chunk) => ({
      chunk_id: chunk.chunk_id,
      chunk_hash: chunk.chunk_hash,
      size_bytes: chunk.size_bytes,
      priority: chunk.priority,
    }));

  return {
    dataset_id: datasetId,
    namespace,
    manifest_id: remoteDataset.manifest_id,
    missing_chunks: missingChunks,
    stale_chunks: [],
    superseded_manifest_id: localDataset.manifest_id,
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
    // Set when this REQUEST is the DTN cross-manifest case (see
    // computeCrossManifestDiff): APPLY should retire this older manifest_id
    // for the dataset once every requested chunk lands, rather than keep it
    // alongside the new one.
    superseded_manifest_id: diff.superseded_manifest_id ?? null,
  };
}
