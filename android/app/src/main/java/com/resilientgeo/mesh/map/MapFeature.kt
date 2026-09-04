package com.resilientgeo.mesh.map

import com.resilientgeo.mesh.ingest.StoredEvent
import org.json.JSONObject

data class MapFeature(val storedEvent: StoredEvent, val geometry: Geometry) {
    companion object {
        /** Returns null for a stored event whose geometry this MVP map doesn't render yet (see [GeoJson]). */
        fun from(storedEvent: StoredEvent): MapFeature? {
            val geometryJson = JSONObject(storedEvent.eventJson).optJSONObject("geometry") ?: return null
            val geometry = GeoJson.parse(geometryJson) ?: return null
            return MapFeature(storedEvent, geometry)
        }
    }
}
