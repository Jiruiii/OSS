package com.resilientgeo.mesh.trust

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CanonicalTest {

    @Test
    fun `sorts object keys by UTF-8 byte order`() {
        val obj = JSONObject().put("b", 1).put("a", 2).put("A", 3)
        // 'A' (0x41) sorts before 'a' and 'b' (0x61, 0x62) in byte order.
        assertEquals("""{"A":3,"a":2,"b":1}""", Canonical.canonicalize(obj))
    }

    @Test
    fun `keeps array order and nests objects`() {
        val obj = JSONObject().put("list", org.json.JSONArray().put(2).put(1))
        assertEquals("""{"list":[2,1]}""", Canonical.canonicalize(obj))
    }

    @Test
    fun `integral doubles serialize without a decimal point, matching JS`() {
        // 24.0 parses from GeoJSON as a Double but must canonicalize as "24",
        // exactly like JS's JSON.stringify(24.0) === "24" — this is what
        // pipeline/lib/canonical.mjs actually produced for the polygon fixture.
        assertEquals("24", Canonical.canonicalize(24.0))
        assertEquals("0", Canonical.canonicalize(0.0))
        assertEquals("-3", Canonical.canonicalize(-3.0))
    }

    @Test
    fun `non-integral doubles keep their decimal digits`() {
        assertEquals("121.599", Canonical.canonicalize(121.599))
        assertEquals("23.981", Canonical.canonicalize(23.981))
    }

    @Test
    fun `numbers parsed from real JSON text canonicalize the same as literal doubles`() {
        // org.json's real implementation (as opposed to the Android stub)
        // parses decimal literals as BigDecimal, not Double — this failed
        // with "unsupported canonical JSON value: BigDecimal" until
        // Canonical.canonicalize() gained a BigDecimal branch. Every event
        // fixture is loaded this way (JSONObject(text)), so this is the
        // actual code path signature verification depends on, not just the
        // Double-literal tests above.
        val parsed = JSONObject("""{"lon":121.5993,"lat":25.0825,"count":24.0}""")
        assertEquals("121.5993", Canonical.canonicalize(parsed.get("lon")))
        assertEquals("25.0825", Canonical.canonicalize(parsed.get("lat")))
        assertEquals("24", Canonical.canonicalize(parsed.get("count")))
    }

    @Test
    fun `escapes control characters but passes through unicode`() {
        assertEquals(""""line1\nline2"""", Canonical.canonicalize("line1\nline2"))
        assertEquals(""""台9線"""", Canonical.canonicalize("台9線"))
    }

    @Test
    fun `sha256Canonical of the empty object matches the known Node output`() {
        // node -e "const {sha256Canonical}=await import('./pipeline/lib/canonical.mjs'); console.log(sha256Canonical({}))"
        assertEquals(
            "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
            Canonical.sha256Canonical(JSONObject()),
        )
    }
}
