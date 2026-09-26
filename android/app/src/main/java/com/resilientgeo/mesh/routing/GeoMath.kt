package com.resilientgeo.mesh.routing

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** WGS84 longitude/latitude in degrees, matching the data contract's [lon, lat] order. */
data class LonLat(val lon: Double, val lat: Double) {
    val isValid: Boolean
        get() = lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -90.0..90.0
}

/** Axis-aligned [minLon, minLat, maxLon, maxLat]. */
data class BBox(val minLon: Double, val minLat: Double, val maxLon: Double, val maxLat: Double) {
    fun intersects(other: BBox): Boolean =
        minLon <= other.maxLon && maxLon >= other.minLon && minLat <= other.maxLat && maxLat >= other.minLat

    fun expandedByMeters(meters: Double): BBox {
        val dLat = meters / GeoMath.METERS_PER_DEGREE_LAT
        val dLon = meters / (GeoMath.METERS_PER_DEGREE_LAT * cos(Math.toRadians((minLat + maxLat) / 2)))
        return BBox(minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat)
    }

    companion object {
        fun of(points: List<LonLat>): BBox = BBox(
            points.minOf { it.lon },
            points.minOf { it.lat },
            points.maxOf { it.lon },
            points.maxOf { it.lat },
        )
    }
}

/**
 * A polygon as its rings: the first is the outer boundary, the rest are
 * holes. Ring closure (repeating the first point) is optional.
 */
data class PolygonRings(val rings: List<List<LonLat>>) {
    val bbox: BBox = BBox.of(rings.first())
}

object GeoMath {
    private const val EARTH_RADIUS_M = 6_371_008.8
    const val METERS_PER_DEGREE_LAT = 111_320.0

    fun haversineMeters(a: LonLat, b: LonLat): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
    }

    /**
     * Distance from [p] to segment [a]-[b] in metres, using a local
     * equirectangular projection around [p]. Accurate to well under a metre at
     * the few-hundred-metre scales routing uses it for.
     */
    fun pointToSegmentMeters(p: LonLat, a: LonLat, b: LonLat): Double {
        val kx = METERS_PER_DEGREE_LAT * cos(Math.toRadians(p.lat))
        val ky = METERS_PER_DEGREE_LAT
        val ax = (a.lon - p.lon) * kx
        val ay = (a.lat - p.lat) * ky
        val bx = (b.lon - p.lon) * kx
        val by = (b.lat - p.lat) * ky
        val dx = bx - ax
        val dy = by - ay
        val lengthSquared = dx * dx + dy * dy
        val t = if (lengthSquared == 0.0) 0.0 else ((-ax * dx - ay * dy) / lengthSquared).coerceIn(0.0, 1.0)
        val cx = ax + t * dx
        val cy = ay + t * dy
        return sqrt(cx * cx + cy * cy)
    }

    /** Even-odd test over every ring, so a point inside a hole is outside the polygon. Boundary counts as inside. */
    fun pointInPolygon(p: LonLat, polygon: PolygonRings): Boolean {
        if (p.lon < polygon.bbox.minLon || p.lon > polygon.bbox.maxLon ||
            p.lat < polygon.bbox.minLat || p.lat > polygon.bbox.maxLat
        ) {
            return false
        }
        var inside = false
        for (ring in polygon.rings) {
            if (onRing(p, ring)) return true
            if (pointInRing(p, ring)) inside = !inside
        }
        return inside
    }

    /** True when the segment has an endpoint inside the polygon or crosses any of its rings. */
    fun segmentIntersectsPolygon(a: LonLat, b: LonLat, polygon: PolygonRings): Boolean {
        val segmentBox = BBox(min(a.lon, b.lon), min(a.lat, b.lat), max(a.lon, b.lon), max(a.lat, b.lat))
        if (!segmentBox.intersects(polygon.bbox)) return false
        if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true
        for (ring in polygon.rings) {
            for (i in ring.indices) {
                val c = ring[i]
                val d = ring[(i + 1) % ring.size]
                if (segmentsIntersect(a, b, c, d)) return true
            }
        }
        return false
    }

    fun segmentsIntersect(a: LonLat, b: LonLat, c: LonLat, d: LonLat): Boolean {
        val d1 = cross(c, d, a)
        val d2 = cross(c, d, b)
        val d3 = cross(a, b, c)
        val d4 = cross(a, b, d)
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
        return (d1 == 0.0 && onSegment(c, d, a)) || (d2 == 0.0 && onSegment(c, d, b)) ||
            (d3 == 0.0 && onSegment(a, b, c)) || (d4 == 0.0 && onSegment(a, b, d))
    }

    fun centroid(polygon: PolygonRings): LonLat {
        val ring = polygon.rings.first()
        return LonLat(ring.map { it.lon }.average(), ring.map { it.lat }.average())
    }

    private fun pointInRing(p: LonLat, ring: List<LonLat>): Boolean {
        var inside = false
        var j = ring.size - 1
        for (i in ring.indices) {
            val a = ring[i]
            val b = ring[j]
            if ((a.lat > p.lat) != (b.lat > p.lat) &&
                p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon
            ) {
                inside = !inside
            }
            j = i
        }
        return inside
    }

    private fun onRing(p: LonLat, ring: List<LonLat>): Boolean =
        ring.indices.any { i ->
            val a = ring[i]
            val b = ring[(i + 1) % ring.size]
            cross(a, b, p) == 0.0 && onSegment(a, b, p)
        }

    private fun cross(o: LonLat, a: LonLat, b: LonLat): Double =
        (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon)

    private fun onSegment(a: LonLat, b: LonLat, p: LonLat): Boolean =
        p.lon in min(a.lon, b.lon)..max(a.lon, b.lon) && p.lat in min(a.lat, b.lat)..max(a.lat, b.lat)
}
