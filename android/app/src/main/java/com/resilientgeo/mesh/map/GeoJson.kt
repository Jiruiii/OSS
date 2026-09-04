package com.resilientgeo.mesh.map

import org.json.JSONArray
import org.json.JSONObject

/**
 * Parses the subset of GeoJSON that `event-v0.schema.json` allows and that
 * the bundled test-area fixtures actually use. MultiPoint/MultiLineString/
 * MultiPolygon/GeometryCollection are valid per the schema but unused by
 * phase 1's fixtures, so they are not rendered yet (returns null; the
 * caller skips the feature rather than crashing on it).
 */
object GeoJson {

    fun parse(geometry: JSONObject): Geometry? = when (geometry.optString("type")) {
        "Point" -> geometry.optJSONArray("coordinates")?.let { Geometry.Point(it.getDouble(0), it.getDouble(1)) }
        "LineString" -> geometry.optJSONArray("coordinates")?.let { Geometry.LineString(pointList(it)) }
        "Polygon" -> geometry.optJSONArray("coordinates")?.let { rings ->
            Geometry.Polygon((0 until rings.length()).map { pointList(rings.getJSONArray(it)) })
        }
        else -> null
    }

    private fun pointList(coordinates: JSONArray): List<Pair<Double, Double>> =
        (0 until coordinates.length()).map { index ->
            val point = coordinates.getJSONArray(index)
            point.getDouble(0) to point.getDouble(1)
        }
}
