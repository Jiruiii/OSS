package com.resilientgeo.mesh.data

import androidx.room.Entity

/**
 * One verified `chunk-v0` this node holds locally.
 *
 * Without this table a node has no way to answer "what do I already have?"
 * — the events table stores events, and chunk boundaries are not
 * recoverable from them. That gap is why both HELLO summaries in the peer
 * sync demo used to be hardcoded JSON: a node literally could not describe
 * its own inventory, so it could never relay to a third device, and the
 * mesh could not sustain itself past the two devices whose fixtures were
 * written by hand.
 *
 * Only the fields `schemas/peer-summary-v0.schema.json` needs are kept.
 * The chunk body is not stored: its events are already applied to the
 * events table, and holding a second copy would double the on-device
 * footprint for no reader. This means a peer summary built from this table
 * asserts "I verified and applied this chunk", which is exactly what
 * `computeDiff` needs, not "I can re-serve these exact bytes" — re-serving
 * is a separate capability this MVP does not claim.
 */
@Entity(tableName = "chunks", primaryKeys = ["datasetId", "namespace", "chunkId"])
data class ChunkEntity(
    val datasetId: String,
    val namespace: String,
    val chunkId: String,
    val manifestId: String,
    val datasetVersion: Int,
    val chunkHash: String,
    val sizeBytes: Long,
    /** Name of a [com.resilientgeo.mesh.protocol.Priority] value. */
    val priority: String,
    val receivedAtEpochMillis: Long,
)
