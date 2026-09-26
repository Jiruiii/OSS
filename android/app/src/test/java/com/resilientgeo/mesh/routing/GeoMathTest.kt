package com.resilientgeo.mesh.routing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos

class GeoMathTest {

    @Test
    fun `haversine matches known degree lengths in Neihu within half a percent`() {
        // One degree of latitude on the mean-radius sphere is 111,195 m.
        val north = GeoMath.haversineMeters(LonLat(121.59, 25.0), LonLat(121.59, 26.0))
        assertEquals(111_195.0, north, 111_195.0 * 0.005)
        // One degree of longitude at 25.08N is 111,195 * cos(25.08 deg).
        val east = GeoMath.haversineMeters(LonLat(121.0, 25.08), LonLat(122.0, 25.08))
        val expected = 111_195.0 * cos(Math.toRadians(25.08))
        assertEquals(expected, east, expected * 0.005)
    }

    @Test
    fun `point to segment distance handles the interior and both ends`() {
        val a = LonLat(121.500, 25.000)
        val b = LonLat(121.502, 25.000)
        val above = LonLat(121.501, 25.0001)
        assertEquals(11.1, GeoMath.pointToSegmentMeters(above, a, b), 0.2)
        val beyond = LonLat(121.503, 25.000)
        assertEquals(GeoMath.haversineMeters(beyond, b), GeoMath.pointToSegmentMeters(beyond, a, b), 0.5)
    }

    private val outer = listOf(LonLat(0.0, 0.0), LonLat(10.0, 0.0), LonLat(10.0, 10.0), LonLat(0.0, 10.0), LonLat(0.0, 0.0))
    private val hole = listOf(LonLat(4.0, 4.0), LonLat(6.0, 4.0), LonLat(6.0, 6.0), LonLat(4.0, 6.0), LonLat(4.0, 4.0))
    private val donut = PolygonRings(listOf(outer, hole))

    @Test
    fun `point in polygon covers inside, outside, holes and boundaries`() {
        assertTrue(GeoMath.pointInPolygon(LonLat(2.0, 2.0), donut))
        assertFalse(GeoMath.pointInPolygon(LonLat(12.0, 2.0), donut))
        assertFalse(GeoMath.pointInPolygon(LonLat(5.0, 5.0), donut))
        assertTrue(GeoMath.pointInPolygon(LonLat(0.0, 5.0), donut))
        assertTrue(GeoMath.pointInPolygon(LonLat(4.0, 5.0), donut))
    }

    @Test
    fun `a segment with both ends outside that crosses the polygon intersects it`() {
        assertTrue(GeoMath.segmentIntersectsPolygon(LonLat(-1.0, 2.0), LonLat(11.0, 2.0), donut))
        assertTrue(GeoMath.segmentIntersectsPolygon(LonLat(2.0, 2.0), LonLat(3.0, 3.0), donut))
        assertFalse(GeoMath.segmentIntersectsPolygon(LonLat(-1.0, -1.0), LonLat(-1.0, 11.0), donut))
        // Entirely inside the hole: not in the polygon.
        assertFalse(GeoMath.segmentIntersectsPolygon(LonLat(4.5, 4.5), LonLat(5.5, 5.5), donut))
    }
}
