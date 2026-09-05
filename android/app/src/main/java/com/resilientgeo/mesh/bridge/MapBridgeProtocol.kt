package com.resilientgeo.mesh.bridge

import com.resilientgeo.mesh.data.EventEntity
import com.resilientgeo.mesh.ingest.IngestResult

/** StandardMessageCodec-safe replies for the approved map MethodChannel contract. */
object MapBridgeProtocol {

    fun eventSnapshot(events: List<EventEntity>): List<Map<String, Any?>> =
        events.map(EventPayloadMapper::toMessage)

    fun initialState(
        events: List<EventEntity>,
        emergencyModeEnabled: Boolean,
    ): Map<String, Any?> = mapOf(
        "events" to eventSnapshot(events),
        "emergency_mode_enabled" to emergencyModeEnabled,
    )

    fun fixtureLoadSummary(results: List<IngestResult>): Map<String, Int> {
        val inserted = results.count { it is IngestResult.Inserted }
        val updated = results.count { it is IngestResult.Updated }
        return mapOf(
            "processed" to results.size,
            "inserted" to inserted,
            "updated" to updated,
            "rejected" to results.size - inserted - updated,
        )
    }

    fun emergencyModeResult(enabled: Boolean): Map<String, Boolean> = mapOf("enabled" to enabled)
}
