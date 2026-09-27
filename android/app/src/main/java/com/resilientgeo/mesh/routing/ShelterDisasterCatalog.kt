package com.resilientgeo.mesh.routing

/** Built only from verified static features, never from caller-supplied eligibility. */
class ShelterDisasterCatalog(private val shelters: Map<String, Entry>) {
    data class Entry(val location: LonLat?, val types: Set<String>)

    fun warning(id: String, destination: LonLat, disasterType: String): RouteWarning? {
        val entry = shelters[id]
        if (entry?.location != null && GeoMath.haversineMeters(entry.location, destination) > 1.0) {
            return RouteWarning("SHELTER_LOCATION_MISMATCH", null, "避難所座標與離線資料不一致，請重新選擇")
        }
        val known = entry?.types.orEmpty().intersect(labels.values.toSet())
        if (known.isEmpty()) return RouteWarning("SHELTER_DISASTER_UNKNOWN", null, "此避難所未提供適用災害類別，無法確認適用於${labels[disasterType]}")
        if (labels[disasterType] !in known) return RouteWarning("SHELTER_DISASTER_MISMATCH", null, "此避難所資料未列為適用於${labels[disasterType]}，請選擇其他場所")
        return null
    }

    companion object {
        val labels = linkedMapOf("flood" to "水災", "earthquake" to "震災", "debris_flow" to "土石流", "tsunami" to "海嘯", "nuclear" to "核子事故", "landslide" to "坡地災害")

        fun fromFeatures(features: List<Map<String, Any?>>): ShelterDisasterCatalog = ShelterDisasterCatalog(
            features.filter { it["kind"] == "shelter" }.mapNotNull { feature ->
                val id = feature["id"] as? String ?: return@mapNotNull null
                val geometry = feature["geometry"] as? Map<*, *>
                val coordinates = geometry?.get("coordinates") as? List<*>
                val location = if (geometry?.get("type") == "Point" && coordinates?.size == 2) {
                    val lon = coordinates[0] as? Number
                    val lat = coordinates[1] as? Number
                    if (lon != null && lat != null) LonLat(lon.toDouble(), lat.toDouble()) else null
                } else null
                id to Entry(location, (feature["disaster_types"] as? List<*>)?.filterIsInstance<String>()?.map { it.trim() }?.toSet().orEmpty())
            }.toMap(),
        )
    }
}
