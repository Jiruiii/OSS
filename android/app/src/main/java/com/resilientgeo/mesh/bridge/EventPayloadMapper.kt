package com.resilientgeo.mesh.bridge

import com.resilientgeo.mesh.data.EventEntity
import org.json.JSONArray
import org.json.JSONObject

/**
 * Converts a persisted event document into values accepted by Flutter's
 * StandardMessageCodec. Room owns the event JSON; this mapper only adds the
 * local apply outcome and never exposes org.json containers across the channel.
 */
object EventPayloadMapper {

    fun toMessage(event: EventEntity): Map<String, Any?> =
        JSONObject(event.eventJson)
            .toMessageMap()
            .toMutableMap()
            .apply { put("apply_state", event.applyState) }

    private fun JSONObject.toMessageMap(): Map<String, Any?> {
        val values = LinkedHashMap<String, Any?>()
        val names = keys()
        while (names.hasNext()) {
            val name = names.next()
            values[name] = get(name).toMessageValue()
        }
        return values
    }

    private fun JSONArray.toMessageList(): List<Any?> =
        List(length()) { index -> get(index).toMessageValue() }

    private fun Any?.toMessageValue(): Any? = when (this) {
        null, JSONObject.NULL -> null
        is JSONObject -> toMessageMap()
        is JSONArray -> toMessageList()
        is String, is Boolean, is Int, is Long, is Double, is Float, is ByteArray -> this
        is Number -> toDouble()
        else -> toString()
    }
}
