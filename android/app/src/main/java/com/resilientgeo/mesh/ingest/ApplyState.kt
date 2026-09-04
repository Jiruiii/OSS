package com.resilientgeo.mesh.ingest

/**
 * Mirrors `eventState()` in `pipeline/lib/contract.mjs`: an event that
 * fails verification is never stored at all, so this only describes events
 * that made it into the local database.
 */
enum class ApplyState {
    CURRENT,
    EXPIRED,
    /** Stored but not treated as authoritative map state — crowd.* namespaces, per the data contract. */
    UNVERIFIED,
}
