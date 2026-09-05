package com.resilientgeo.mesh.protocol

/**
 * Kotlin port of `pipeline/lib/peer-sync.mjs`. Must behave identically to
 * the Node module for the same inputs — `PeerSyncTest` replays the exact
 * fixtures under `pipeline/test/peer-sync.test.mjs` to prove it.
 *
 * Transport-agnostic by design: this only reasons about `PeerSummary`
 * values. `BleGattTransport` (module 甲) moves bytes; this decides which
 * bytes matter.
 */
object PeerSync {

    /**
     * Compare what the local node has against what a remote peer advertised
     * in its HELLO, for a single dataset/namespace.
     */
    fun computeDiff(local: PeerSummary, remote: PeerSummary, datasetId: String, namespace: String): DiffResult {
        val localDataset = findDataset(local, datasetId, namespace)
        val remoteDataset = findDataset(remote, datasetId, namespace)

        if (localDataset.manifestId != remoteDataset.manifestId) {
            return computeCrossManifestDiff(localDataset, remoteDataset, datasetId, namespace)
        }

        val localChunksById = localDataset.chunks.associateBy { it.chunkId }

        val missingChunks = mutableListOf<ChunkRef>()
        val staleChunks = mutableListOf<ChunkRef>()

        for (remoteChunk in remoteDataset.chunks) {
            val localChunk = localChunksById[remoteChunk.chunkId]
            when {
                localChunk == null -> missingChunks.add(remoteChunk.toRef())
                localChunk.chunkHash != remoteChunk.chunkHash -> staleChunks.add(remoteChunk.toRef())
            }
        }

        return DiffResult(
            datasetId = datasetId,
            namespace = namespace,
            manifestId = remoteDataset.manifestId,
            missingChunks = missingChunks,
            staleChunks = staleChunks,
            supersededManifestId = null,
        )
    }

    /**
     * DTN-model diff for a peer carrying a *different* manifest_id for the
     * same dataset — e.g. a node walks into a shelter with v137 while
     * everyone there is still on v136 (see docs/peer-sync-v0.md "跨
     * manifest_id 的 DIFF 行為"). Must not be a hard error: this is the
     * exact scenario opportunistic contact exists for.
     *
     * v0 rule: the strictly newer dataset_version wins wholesale for this
     * dataset. chunk_id/chunk_hash are not stable across dataset_version
     * under fixed-size chunking, so this is not a byte-identical diff
     * against the old manifest — matching by chunk_hash only dedupes the
     * rare byte-identical-across-versions case.
     */
    private fun computeCrossManifestDiff(
        local: DatasetSummary,
        remote: DatasetSummary,
        datasetId: String,
        namespace: String,
    ): DiffResult {
        if (remote.datasetVersion == local.datasetVersion) {
            throw PeerSyncException(
                "manifest mismatch for $namespace/$datasetId: " +
                    "local=${local.manifestId} remote=${remote.manifestId} " +
                    "both claim dataset_version=${local.datasetVersion}",
            )
        }

        if (remote.datasetVersion < local.datasetVersion) {
            // Remote carries an older lineage for this dataset; nothing for
            // the local node to request here.
            return DiffResult(
                datasetId = datasetId,
                namespace = namespace,
                manifestId = local.manifestId,
                missingChunks = emptyList(),
                staleChunks = emptyList(),
                supersededManifestId = null,
            )
        }

        val localHashes = local.chunks.map { it.chunkHash }.toHashSet()
        val missingChunks = remote.chunks
            .filter { it.chunkHash !in localHashes }
            .map { it.toRef() }

        return DiffResult(
            datasetId = datasetId,
            namespace = namespace,
            manifestId = remote.manifestId,
            missingChunks = missingChunks,
            staleChunks = emptyList(),
            supersededManifestId = local.manifestId,
        )
    }

    /**
     * Turn a DIFF result into a REQUEST message: missing + stale chunks,
     * ordered CRITICAL > HIGH > NORMAL > LOW, then smallest-first within
     * the same priority.
     *
     * [offsets] carries how many bytes of a given chunk this node already
     * holds from an earlier, interrupted contact, keyed by `chunk_id`.
     * ADR-001 makes this load-bearing rather than a nicety: at a measured
     * 3.8-4.4 KB/s over BLE GATT a single opportunistic contact window
     * often cannot finish one chunk, so a REQUEST that always restarted at
     * 0 would make no forward progress across contacts however many times
     * the two nodes met. `BleGattTransport.resume()` already does the
     * byte-level work; this is what lets the protocol layer ask for it
     * instead of the demo activity hand-assembling the message.
     *
     * Must stay behaviourally identical to `buildRequest()` in
     * pipeline/lib/peer-sync.mjs — including dropping an already-complete
     * chunk rather than requesting a zero-length range.
     */
    fun buildRequest(
        diff: DiffResult,
        resume: Boolean = true,
        offsets: Map<String, Long> = emptyMap(),
    ): RequestMessage {
        val wanted = (diff.missingChunks + diff.staleChunks)
            .sortedWith(compareBy({ it.priority.ordinal }, { it.sizeBytes }))
            .map {
                val held = offsets[it.chunkId] ?: 0L
                if (held < 0L || held > it.sizeBytes) {
                    throw PeerSyncException(
                        "offset for ${it.chunkId} must be within [0, ${it.sizeBytes}], got $held",
                    )
                }
                RequestChunk(
                    chunkId = it.chunkId,
                    chunkHash = it.chunkHash,
                    priority = it.priority,
                    offsetBytes = held,
                    maxBytes = it.sizeBytes - held,
                )
            }
            .filter { it.maxBytes > 0L }

        return RequestMessage(
            datasetId = diff.datasetId,
            namespace = diff.namespace,
            manifestId = diff.manifestId,
            chunks = wanted,
            resume = resume,
            maxTotalBytes = wanted.sumOf { it.maxBytes },
            supersededManifestId = diff.supersededManifestId,
        )
    }

    private fun findDataset(summary: PeerSummary, datasetId: String, namespace: String): DatasetSummary =
        summary.datasets.find { it.datasetId == datasetId && it.namespace == namespace }
            ?: throw PeerSyncException(
                "peer summary for ${summary.nodeId} has no dataset $namespace/$datasetId",
            )

    private fun ChunkSummary.toRef() = ChunkRef(chunkId, chunkHash, sizeBytes, priority)
}

data class ChunkRef(
    val chunkId: String,
    val chunkHash: String,
    val sizeBytes: Long,
    val priority: Priority,
)

data class DiffResult(
    val datasetId: String,
    val namespace: String,
    val manifestId: String,
    val missingChunks: List<ChunkRef>,
    val staleChunks: List<ChunkRef>,
    /** Set when this DIFF is the cross-manifest DTN case; see computeCrossManifestDiff. */
    val supersededManifestId: String?,
)

data class RequestChunk(
    val chunkId: String,
    val chunkHash: String,
    val priority: Priority,
    val offsetBytes: Long,
    val maxBytes: Long,
)

data class RequestMessage(
    val datasetId: String,
    val namespace: String,
    val manifestId: String,
    val chunks: List<RequestChunk>,
    val resume: Boolean,
    val maxTotalBytes: Long,
    val supersededManifestId: String?,
)

/** Mirrors the RangeError thrown by pipeline/lib/peer-sync.mjs. */
class PeerSyncException(message: String) : RuntimeException(message)
