package com.resilientgeo.mesh.bridge

import com.resilientgeo.mesh.data.EventEntity
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class EventPayloadMapperTest {

    @Test
    fun `maps the complete persisted document recursively and overlays Room apply state`() {
        val mapped = EventPayloadMapper.toMessage(eventEntity())

        assertEquals("official.tdx", mapped["namespace"])
        assertEquals("road:dahu-01", mapped["event_id"])
        assertEquals(2, mapped["event_version"])
        assertEquals("CURRENT", mapped["apply_state"])
        assertEquals("android-demo-2026", mapped["signing_key_id"])

        val attributes = mapped["attributes"] as Map<*, *>
        assertEquals("debris_cleared", attributes["reason"])
        assertNull(attributes["optional_note"])

        val geometry = mapped["geometry"] as Map<*, *>
        assertEquals("LineString", geometry["type"])
        val coordinates = geometry["coordinates"] as List<*>
        assertEquals(121.5993, (coordinates[0] as List<*>)[0])
        assertEquals(25.085, (coordinates[1] as List<*>)[1])
    }

    @Test
    fun `message values contain no JSONObject or JSONArray instances`() {
        val mapped = EventPayloadMapper.toMessage(eventEntity())

        assertFalse(containsJsonContainer(mapped))
    }

    private fun eventEntity() = EventEntity(
        namespace = "official.tdx",
        eventId = "road:dahu-01",
        eventVersion = 2,
        eventType = "ROAD_STATUS",
        severity = "HIGH",
        expiresAt = "2099-01-01T00:00:00Z",
        applyState = "CURRENT",
        eventJson = """
            {
              "namespace": "official.tdx",
              "event_id": "road:dahu-01",
              "event_version": 2,
              "event_type": "ROAD_STATUS",
              "severity": "HIGH",
              "source": "TDX",
              "issued_at": "2026-09-01T06:32:00Z",
              "expires_at": "2099-01-01T00:00:00Z",
              "geometry": {
                "type": "LineString",
                "coordinates": [[121.5993, 25.0825], [121.6053, 25.085]]
              },
              "attributes": {
                "reason": "debris_cleared",
                "optional_note": null
              },
              "signing_key_id": "android-demo-2026",
              "provenance": {
                "transport_source": {
                  "kind": "server",
                  "node_id": "fixture-ingest"
                }
              }
            }
        """.trimIndent(),
        storedAtEpochMillis = 1_725_168_000_000,
    )

    private fun containsJsonContainer(value: Any?): Boolean = when (value) {
        is JSONObject, is JSONArray -> true
        is Map<*, *> -> value.any { (key, item) -> containsJsonContainer(key) || containsJsonContainer(item) }
        is Iterable<*> -> value.any(::containsJsonContainer)
        else -> false
    }
}
