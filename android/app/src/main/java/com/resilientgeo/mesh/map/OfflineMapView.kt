package com.resilientgeo.mesh.map

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import com.resilientgeo.mesh.ingest.ApplyState

/**
 * A fully offline "basemap" for the test area: no tiles, no network, just
 * a fixed geographic bounding box drawn as a grid with road / shelter /
 * hazard geometry rendered on top of it from the local database.
 *
 * This is a deliberate phase-1 shortcut, not an oversight — see
 * android/README.md "Why not a tiled basemap". It already satisfies the
 * acceptance check that matters for this phase: turn the network off,
 * restart the app, and the last known map state is still readable,
 * because it is reconstructed from Room, not downloaded.
 */
class OfflineMapView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    // Taipei Neihu district (內湖區) — the demo area the team standardized
    // on in data/fixtures/neihu/scenario.json, with a margin around its five
    // named areas (neihu.xihu/tech-park/wende/dahu/donghu).
    private val minLon = 121.55
    private val maxLon = 121.63
    private val minLat = 25.05
    private val maxLat = 25.10

    private var features: List<MapFeature> = emptyList()

    private val backgroundPaint = Paint().apply { color = Color.parseColor("#0F1A24") }
    private val gridPaint = Paint().apply { color = Color.parseColor("#1E3040"); strokeWidth = 1f }
    private val roadPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 8f
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val pointPaint = Paint().apply { style = Paint.Style.FILL; isAntiAlias = true }
    private val areaPaint = Paint().apply { style = Paint.Style.FILL; alpha = 90; isAntiAlias = true }

    fun setFeatures(newFeatures: List<MapFeature>) {
        features = newFeatures
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), backgroundPaint)
        drawGrid(canvas)
        for (feature in features) drawFeature(canvas, feature)
    }

    private fun drawGrid(canvas: Canvas) {
        val cells = 6
        for (i in 0..cells) {
            val x = width * i / cells.toFloat()
            val y = height * i / cells.toFloat()
            canvas.drawLine(x, 0f, x, height.toFloat(), gridPaint)
            canvas.drawLine(0f, y, width.toFloat(), y, gridPaint)
        }
    }

    private fun drawFeature(canvas: Canvas, feature: MapFeature) {
        val color = colorFor(feature)
        when (val geometry = feature.geometry) {
            is Geometry.LineString -> {
                roadPaint.color = color
                canvas.drawPath(pathFor(geometry.points), roadPaint)
            }
            is Geometry.Point -> {
                pointPaint.color = color
                val (x, y) = project(geometry.lon, geometry.lat)
                canvas.drawCircle(x, y, 14f, pointPaint)
            }
            is Geometry.Polygon -> {
                areaPaint.color = color
                for (ring in geometry.rings) canvas.drawPath(pathFor(ring), areaPaint)
            }
        }
    }

    private fun pathFor(points: List<Pair<Double, Double>>): Path {
        val path = Path()
        points.forEachIndexed { index, (lon, lat) ->
            val (x, y) = project(lon, lat)
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        if (points.size > 2 && points.first() == points.last()) path.close()
        return path
    }

    private fun colorFor(feature: MapFeature): Int {
        val state = feature.storedEvent.applyState
        if (state == ApplyState.EXPIRED) return Color.parseColor("#5C6B73")
        if (state == ApplyState.UNVERIFIED) return Color.parseColor("#AB47BC")
        return when {
            feature.geometry is Geometry.LineString -> Color.parseColor("#4FC3F7")
            feature.storedEvent.severity == "CRITICAL" -> Color.parseColor("#EF5350")
            feature.storedEvent.severity == "HIGH" -> Color.parseColor("#FFA726")
            else -> Color.parseColor("#66BB6A")
        }
    }

    private fun project(lon: Double, lat: Double): Pair<Float, Float> {
        val x = ((lon - minLon) / (maxLon - minLon)).toFloat() * width
        // Screen Y grows downward; latitude grows northward (upward), so flip.
        val y = (1f - ((lat - minLat) / (maxLat - minLat)).toFloat()) * height
        return x to y
    }
}
