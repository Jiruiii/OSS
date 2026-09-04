package com.resilientgeo.mesh.trust

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.nio.charset.StandardCharsets

/**
 * Kotlin port of `pipeline/lib/canonical.mjs`'s `canonicalize()`.
 *
 * Must byte-for-byte match the Node canonicalizer: objects sorted by the
 * UTF-8 byte order of their keys, arrays keep source order, no insignificant
 * whitespace. `signEvent`/`verifyEvent` on the server hash and sign exactly
 * this string, so any divergence here breaks every signature check.
 *
 * Number formatting mirrors JS's `JSON.stringify`, which prints the shortest
 * decimal that round-trips (and drops `.0` for integral values, e.g. 24.0 ->
 * "24"). This port handles every value produced by this project's event
 * fixtures (small integers and short-decimal coordinates); it is not a
 * general ECMA-262 Number::toString implementation and does not attempt
 * scientific notation for extreme magnitudes.
 */
object Canonical {

    private const val FORM_FEED_CODE = 0x0C

    fun canonicalize(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> "null"
            is String -> encodeString(value)
            is Boolean -> if (value) "true" else "false"
            is Int -> value.toString()
            is Long -> value.toString()
            is Double -> encodeNumber(value)
            is Float -> encodeNumber(value.toDouble())
            is JSONArray -> encodeArray(value)
            is JSONObject -> encodeObject(value)
            is List<*> -> encodeArray(JSONArray(value))
            is Map<*, *> -> encodeObject(JSONObject(value))
            else -> throw IllegalArgumentException("unsupported canonical JSON value: ${value::class}")
        }
    }

    private fun encodeArray(array: JSONArray): String {
        val parts = (0 until array.length()).joinToString(",") { canonicalize(array.get(it)) }
        return "[$parts]"
    }

    private fun encodeObject(obj: JSONObject): String {
        val keys = obj.keys().asSequence().toMutableList()
        keys.sortWith(::compareUtf8)
        val parts = keys.joinToString(",") { key ->
            "${encodeString(key)}:${canonicalize(obj.get(key))}"
        }
        return "{$parts}"
    }

    /** Matches `Buffer.from(a,'utf8').compare(Buffer.from(b,'utf8'))`: unsigned byte-wise order. */
    private fun compareUtf8(a: String, b: String): Int {
        val ba = a.toByteArray(StandardCharsets.UTF_8)
        val bb = b.toByteArray(StandardCharsets.UTF_8)
        val len = minOf(ba.size, bb.size)
        for (i in 0 until len) {
            val diff = (ba[i].toInt() and 0xFF) - (bb[i].toInt() and 0xFF)
            if (diff != 0) return diff
        }
        return ba.size - bb.size
    }

    /** Matches JSON.stringify's string escaping (control chars only; Unicode passes through raw). */
    private fun encodeString(value: String): String {
        val sb = StringBuilder(value.length + 2)
        sb.append('"')
        for (ch in value) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch == '\b' -> sb.append("\\b")
                ch.code == FORM_FEED_CODE -> sb.append("\\f")
                ch == '\n' -> sb.append("\\n")
                ch == '\r' -> sb.append("\\r")
                ch == '\t' -> sb.append("\\t")
                ch.code < 0x20 -> sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                else -> sb.append(ch)
            }
        }
        sb.append('"')
        return sb.toString()
    }

    private fun encodeNumber(value: Double): String {
        if (value.isNaN() || value.isInfinite()) {
            throw IllegalArgumentException("canonical JSON cannot contain non-finite numbers")
        }
        if (value == 0.0) return "0"
        val negative = value < 0
        val abs = Math.abs(value)
        val text = if (abs == Math.floor(abs) && abs < 1e21) {
            BigDecimal(abs).toBigInteger().toString()
        } else {
            abs.toString()
        }
        return if (negative) "-$text" else text
    }

    fun sha256Bytes(bytes: ByteArray): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
        return "sha256:" + digest.joinToString("") { "%02x".format(it) }
    }

    fun sha256Canonical(value: Any?): String {
        return sha256Bytes(canonicalize(value).toByteArray(StandardCharsets.UTF_8))
    }
}
