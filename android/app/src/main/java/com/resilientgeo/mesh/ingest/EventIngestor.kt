package com.resilientgeo.mesh.ingest

import com.resilientgeo.mesh.trust.EventVerifier
import com.resilientgeo.mesh.trust.TrustedKeyStore
import com.resilientgeo.mesh.trust.VerificationResult
import org.json.JSONObject
import java.time.Instant

/**
 * Kotlin port of `ingestEvent()` from `pipeline/lib/contract.mjs` — the
 * apply rules module B is responsible for on Android:
 *
 *  1. Reject anything that fails verification (schema/trust/integrity/signature).
 *  2. A newer `event_version` for the same (namespace, event_id) replaces the stored one.
 *  3. An older or equal version is rejected outright — the store is left untouched.
 *  4. `official.*` and `crowd.*` (or any other) namespaces never overwrite each other,
 *     because identity is (namespace, event_id), not event_id alone.
 *  5. Expired events are still stored (for audit / "last known state"), just flagged.
 */
object EventIngestor {

    fun ingest(store: EventStore, event: JSONObject, trustStore: TrustedKeyStore, now: Instant = Instant.now()): IngestResult {
        val verification = EventVerifier.verify(event, trustStore, now)
        if (verification is VerificationResult.Invalid) {
            return IngestResult.RejectedVerification(verification.stage, verification.errors)
        }
        val valid = verification as VerificationResult.Valid

        val namespace = event.getString("namespace")
        val eventId = event.getString("event_id")
        val eventVersion = event.getInt("event_version")
        val existing = store.find(namespace, eventId)

        if (existing == null) {
            val state = applyStateFor(namespace, valid.expired)
            store.save(toStoredEvent(event, namespace, eventId, eventVersion, state))
            val separateNamespace = store.findUnderOtherNamespace(eventId, namespace) != null
            return IngestResult.Inserted(separateNamespace, state)
        }

        if (eventVersion > existing.eventVersion) {
            val state = applyStateFor(namespace, valid.expired)
            store.save(toStoredEvent(event, namespace, eventId, eventVersion, state))
            return IngestResult.Updated(existing.eventVersion, eventVersion, state)
        }

        if (eventVersion < existing.eventVersion) {
            return IngestResult.RejectedVersionRollback(existing.eventVersion, eventVersion)
        }

        return IngestResult.RejectedSameVersionConflict(existing.eventVersion, eventVersion)
    }

    private fun applyStateFor(namespace: String, expired: Boolean): ApplyState = when {
        expired -> ApplyState.EXPIRED
        namespace.startsWith("crowd.") -> ApplyState.UNVERIFIED
        else -> ApplyState.CURRENT
    }

    private fun toStoredEvent(event: JSONObject, namespace: String, eventId: String, eventVersion: Int, state: ApplyState) = StoredEvent(
        namespace = namespace,
        eventId = eventId,
        eventVersion = eventVersion,
        eventType = event.getString("event_type"),
        severity = event.getString("severity"),
        expiresAt = event.getString("expires_at"),
        applyState = state,
        eventJson = event.toString(),
    )
}
