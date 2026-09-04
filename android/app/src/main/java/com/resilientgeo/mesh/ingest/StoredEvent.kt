package com.resilientgeo.mesh.ingest

/**
 * What the local database actually keeps for one (namespace, event_id).
 * `eventJson` is the full signed Event v0 document, kept verbatim so the
 * map layer can re-read geometry/attributes without re-deriving them.
 */
data class StoredEvent(
    val namespace: String,
    val eventId: String,
    val eventVersion: Int,
    val eventType: String,
    val severity: String,
    val expiresAt: String,
    val applyState: ApplyState,
    val eventJson: String,
)
