package com.resilientgeo.mesh.protocol

import org.json.JSONObject

/**
 * Kotlin model of `schemas/peer-summary-v0.schema.json` — the compact
 * inventory exchanged in HELLO before chunk negotiation.
 *
 * Only the fields `PeerSync` actually reasons about (datasets/chunks) are
 * modeled here. `capabilities` is intentionally not parsed: nothing in the
 * v0 protocol logic branches on it yet, and adding fields nobody reads
 * would just be surface area to keep in sync with the schema for no
 * benefit. Extend this if/when capability negotiation is implemented.
 */
data class PeerSummary(
    val nodeId: String,
    val datasets: List<DatasetSummary>,
) {
    companion object {
        fun fromJson(json: JSONObject): PeerSummary {
            val datasetsJson = json.getJSONArray("datasets")
            val datasets = (0 until datasetsJson.length()).map {
                DatasetSummary.fromJson(datasetsJson.getJSONObject(it))
            }
            return PeerSummary(nodeId = json.getString("node_id"), datasets = datasets)
        }
    }
}

data class DatasetSummary(
    val datasetId: String,
    val namespace: String,
    val manifestId: String,
    val datasetVersion: Int,
    val chunks: List<ChunkSummary>,
) {
    companion object {
        fun fromJson(json: JSONObject): DatasetSummary {
            val chunksJson = json.getJSONArray("chunks")
            val chunks = (0 until chunksJson.length()).map {
                ChunkSummary.fromJson(chunksJson.getJSONObject(it))
            }
            return DatasetSummary(
                datasetId = json.getString("dataset_id"),
                namespace = json.getString("namespace"),
                manifestId = json.getString("manifest_id"),
                datasetVersion = json.getInt("dataset_version"),
                chunks = chunks,
            )
        }
    }
}

data class ChunkSummary(
    val chunkId: String,
    val chunkHash: String,
    val sizeBytes: Long,
    val priority: Priority,
) {
    companion object {
        fun fromJson(json: JSONObject): ChunkSummary = ChunkSummary(
            chunkId = json.getString("chunk_id"),
            chunkHash = json.getString("chunk_hash"),
            sizeBytes = json.getLong("size_bytes"),
            priority = Priority.valueOf(json.getString("priority")),
        )
    }
}

/** Order matters: index is the sort rank used by `PeerSync.buildRequest`. */
enum class Priority {
    CRITICAL, HIGH, NORMAL, LOW,
}
