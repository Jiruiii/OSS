package com.resilientgeo.mesh.ingest

import com.resilientgeo.mesh.trust.EventShapeValidator
import java.time.Instant

/**
 * Mirrors `eventState()` in `pipeline/lib/contract.mjs`: an event that
 * fails verification is never stored at all, so this only describes events
 * that made it into the local database.
 *
 * **This is a function of the current time, not a fact fixed at ingest.**
 * The stored `applyState` column records what the state was when the event
 * was written; it goes stale the moment `expires_at` passes, which is
 * exactly what happens in this project's main scenario — the phone is
 * offline, nothing re-ingests anything, and an event quietly expires in
 * someone's pocket. Anything that *displays* state (list badge, map color)
 * must therefore call [at] with the current clock rather than trusting the
 * stored value, or expired data keeps rendering as authoritative. See
 * `system.md` §4 apply rule 3 and the phase-2 acceptance criterion.
 */
enum class ApplyState {
    CURRENT,
    EXPIRED,

    /** Stored but not treated as authoritative map state — crowd.* namespaces, per the data contract. */
    UNVERIFIED,
    ;

    companion object {

        /**
         * The state an event in [namespace] expiring at [expiresAt] has at [now].
         *
         * Single source of truth for both the ingest-time write
         * ([EventIngestor]) and every read-time render, so the two can't
         * drift apart. Precedence matches `contract.mjs`: expiry wins over
         * namespace, so an expired `crowd.*` event is EXPIRED, not
         * UNVERIFIED.
         */
        fun at(namespace: String, expiresAt: Instant?, now: Instant): ApplyState = when {
            expiresAt != null && !now.isBefore(expiresAt) -> EXPIRED
            namespace.startsWith("crowd.") -> UNVERIFIED
            else -> CURRENT
        }

        /**
         * String-timestamp overload for callers holding a raw stored row.
         *
         * An unparseable `expires_at` can't happen for a stored event —
         * [com.resilientgeo.mesh.trust.EventShapeValidator] rejects those
         * before they reach the database — but if one somehow appears, it
         * is treated as having no expiry rather than silently becoming
         * EXPIRED, which would hide data instead of flagging it.
         */
        fun at(namespace: String, expiresAt: String?, now: Instant): ApplyState =
            at(namespace, EventShapeValidator.parseTimeOrNull(expiresAt), now)
    }
}
