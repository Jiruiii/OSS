package com.resilientgeo.mesh.bridge

import com.resilientgeo.mesh.data.EventEntity
import com.resilientgeo.mesh.ingest.ApplyState
import com.resilientgeo.mesh.ingest.IngestResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MapBridgeProtocolTest {

    @Test
    fun `initial state reply carries mapped Room events and emergency state`() {
        val reply = MapBridgeProtocol.initialState(
            events = listOf(eventEntity()),
            emergencyModeEnabled = true,
        )

        assertEquals(true, reply["emergency_mode_enabled"])
        val events = reply["events"] as List<*>
        assertEquals(1, events.size)
        val event = events.single() as Map<*, *>
        assertEquals("official.tdx", event["namespace"])
        assertEquals("EXPIRED", event["apply_state"])
        assertEquals("ROAD_STATUS", event["event_type"])
    }

    @Test
    fun `event snapshot reply carries the complete mapped Room event`() {
        val reply = MapBridgeProtocol.eventSnapshot(listOf(eventEntity()))

        assertEquals(1, reply.size)
        assertEquals("official.tdx", reply.single()["namespace"])
        assertEquals("EXPIRED", reply.single()["apply_state"])
        assertEquals("OPEN", (reply.single()["attributes"] as Map<*, *>)["status"])
    }

    @Test
    fun `fixture reply reports processed inserted updated and rejected outcomes`() {
        val reply = MapBridgeProtocol.fixtureLoadSummary(
            listOf(
                IngestResult.Inserted(insertedIntoSeparateNamespace = false, state = ApplyState.CURRENT),
                IngestResult.Updated(fromVersion = 1, toVersion = 2, state = ApplyState.CURRENT),
                IngestResult.RejectedSameVersionConflict(
                    storedVersion = 2,
                    incomingVersion = 2,
                ),
            ),
        )

        assertEquals(3, reply["processed"])
        assertEquals(1, reply["inserted"])
        assertEquals(1, reply["updated"])
        assertEquals(1, reply["rejected"])
    }

    @Test
    fun `emergency reply exposes the enabled boolean`() {
        val reply = MapBridgeProtocol.emergencyModeResult(enabled = false)

        assertTrue(reply.containsKey("enabled"))
        assertEquals(false, reply["enabled"])
    }

    private fun eventEntity() = EventEntity(
        namespace = "official.tdx",
        eventId = "road:dahu-01",
        eventVersion = 2,
        eventType = "ROAD_STATUS",
        severity = "HIGH",
        expiresAt = "2026-09-01T07:00:00Z",
        applyState = "EXPIRED",
        eventJson = """
            {
              "namespace": "official.tdx",
              "event_id": "road:dahu-01",
              "event_version": 2,
              "event_type": "ROAD_STATUS",
              "severity": "HIGH",
              "geometry": {"type": "LineString", "coordinates": [[121.5993, 25.0825], [121.6053, 25.085]]},
              "attributes": {"status": "OPEN"}
            }
        """.trimIndent(),
        storedAtEpochMillis = 1_725_168_000_000,
    )
}
