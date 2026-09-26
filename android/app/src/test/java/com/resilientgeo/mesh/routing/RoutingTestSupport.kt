package com.resilientgeo.mesh.routing

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Hand-made 3x3 grid, ~100 m (lon) x ~111 m (lat) per cell, so every route
 * can be worked out on paper:
 *
 *     lat 25.002   6 --- 7 --- 8      rows: way 100 (y=0), 101 (y=1), 102 (y=2)
 *                  |     |     |      cols: way 200 (x=0), 201 (x=1), 202 (x=2)
 *     lat 25.001   3 --- 4 --- 5
 *                  |     |     |      way 900 is a motorway and must not appear.
 *     lat 25.000   0 --- 1 --- 2
 *               121.500 .501  .502
 */
object RoutingTestSupport {
    val NOW: Instant = Instant.parse("2026-09-24T01:00:00Z")

    fun p(x: Int, y: Int) = LonLat(121.500 + x * 0.001, 25.000 + y * 0.001)

    fun grid(): RoadGraph {
        val ways = mutableListOf<RoadGraph.Way>()
        for (y in 0..2) ways += RoadGraph.Way(100L + y, "residential", (0..2).map { p(it, y) })
        for (x in 0..2) ways += RoadGraph.Way(200L + x, "footway", (0..2).map { p(x, it) })
        ways += RoadGraph.Way(900L, "motorway", listOf(p(0, 0), LonLat(121.510, 25.010)))
        return RoadGraph.fromWays("tiny-grid-v1", ways)
    }

    fun realGraph(): RoadGraph = RoadGraph.fromWalkRoadsJson(File("src/main/assets/routing/walk-roads.json").readText())

    fun event(
        eventId: String,
        eventType: String,
        geometry: JSONObject,
        namespace: String = "official.tdx",
        severity: String = "HIGH",
        attributes: JSONObject = JSONObject(),
        issuedAt: String = "2026-09-24T00:00:00Z",
        expiresAt: String = "2099-01-01T00:00:00Z",
        version: Int = 1,
    ): RouteEvent = requireNotNull(
        RouteEvent.fromEventJson(
            JSONObject()
                .put("namespace", namespace)
                .put("event_id", eventId)
                .put("event_version", version)
                .put("event_type", eventType)
                .put("severity", severity)
                .put("issued_at", issuedAt)
                .put("expires_at", expiresAt)
                .put("geometry", geometry)
                .put("attributes", attributes)
                .toString(),
            NOW,
        ),
    )

    fun roadStatus(wayId: Long, status: String, expiresAt: String = "2099-01-01T00:00:00Z") = event(
        eventId = "road:w$wayId-test",
        eventType = "ROAD_STATUS",
        geometry = line(p(0, 0), p(1, 0)),
        attributes = JSONObject().put("status", status),
        expiresAt = expiresAt,
    )

    fun point(at: LonLat) = JSONObject().put("type", "Point").put("coordinates", JSONArray().put(at.lon).put(at.lat))

    fun line(vararg points: LonLat) = JSONObject().put("type", "LineString").put("coordinates", coordinates(points.toList()))

    /** Axis-aligned square of half-size [half] degrees around [center]. */
    fun square(center: LonLat, half: Double): JSONObject {
        val ring = listOf(
            LonLat(center.lon - half, center.lat - half),
            LonLat(center.lon + half, center.lat - half),
            LonLat(center.lon + half, center.lat + half),
            LonLat(center.lon - half, center.lat + half),
            LonLat(center.lon - half, center.lat - half),
        )
        return JSONObject().put("type", "Polygon").put("coordinates", JSONArray().put(coordinates(ring)))
    }

    private fun coordinates(points: List<LonLat>) = JSONArray().apply { points.forEach { put(JSONArray().put(it.lon).put(it.lat)) } }
}
