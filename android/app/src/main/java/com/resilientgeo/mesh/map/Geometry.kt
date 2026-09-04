package com.resilientgeo.mesh.map

/** Longitude/latitude pairs, matching GeoJSON's [lon, lat] coordinate order. */
sealed class Geometry {
    data class Point(val lon: Double, val lat: Double) : Geometry()
    data class LineString(val points: List<Pair<Double, Double>>) : Geometry()
    data class Polygon(val rings: List<List<Pair<Double, Double>>>) : Geometry()
}
