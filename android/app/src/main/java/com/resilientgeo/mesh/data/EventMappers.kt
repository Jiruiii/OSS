package com.resilientgeo.mesh.data

import com.resilientgeo.mesh.ingest.ApplyState
import com.resilientgeo.mesh.ingest.StoredEvent

/** Shared between [RoomEventStore] (writing/reading the DB) and the UI layer (reading for display). */
fun EventEntity.toStoredEvent(): StoredEvent = StoredEvent(
    namespace = namespace,
    eventId = eventId,
    eventVersion = eventVersion,
    eventType = eventType,
    severity = severity,
    expiresAt = expiresAt,
    applyState = ApplyState.valueOf(applyState),
    eventJson = eventJson,
)

fun StoredEvent.toEntity(): EventEntity = EventEntity(
    namespace = namespace,
    eventId = eventId,
    eventVersion = eventVersion,
    eventType = eventType,
    severity = severity,
    expiresAt = expiresAt,
    applyState = applyState.name,
    eventJson = eventJson,
    storedAtEpochMillis = System.currentTimeMillis(),
)
