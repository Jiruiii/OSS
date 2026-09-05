package com.resilientgeo.mesh.ingest

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/**
 * Guards the rule that display state is a function of the current time.
 *
 * The bug this exists to prevent: `applyState` used to be computed once at
 * ingest and read straight back out by the list badge and the map, so an
 * event ingested while CURRENT kept rendering as CURRENT forever — even
 * hours after `expires_at`. That breaks `system.md` §4 apply rule 3 and the
 * phase-2 acceptance criterion ("App 都不把它顯示為目前有效資料"), and it
 * breaks it in exactly this project's main scenario: the phone is offline,
 * nothing re-ingests anything, and the event expires in someone's pocket.
 */
class ApplyStateTest {

    private val issued = Instant.parse("2026-09-01T06:00:00Z")
    private val expires = Instant.parse("2026-09-01T08:00:00Z")

    @Test
    fun `official event before expiry is current`() {
        assertEquals(
            ApplyState.CURRENT,
            ApplyState.at("official.tdx", expires, issued),
        )
    }

    @Test
    fun `same event is expired once the clock passes expires_at`() {
        // The regression: same stored row, later clock, different state.
        assertEquals(
            ApplyState.CURRENT,
            ApplyState.at("official.tdx", expires, expires.minusSeconds(1)),
        )
        assertEquals(
            ApplyState.EXPIRED,
            ApplyState.at("official.tdx", expires, expires.plusSeconds(1)),
        )
    }

    @Test
    fun `expiry boundary is inclusive, matching contract mjs`() {
        // eventState() treats now >= expires_at as expired, not now > expires_at.
        assertEquals(
            ApplyState.EXPIRED,
            ApplyState.at("official.tdx", expires, expires),
        )
    }

    @Test
    fun `crowd namespace is unverified while live`() {
        assertEquals(
            ApplyState.UNVERIFIED,
            ApplyState.at("crowd.reports", expires, issued),
        )
    }

    @Test
    fun `expiry wins over namespace for crowd events`() {
        // Precedence must match applyStateFor in contract.mjs: an expired
        // crowd event is EXPIRED, not UNVERIFIED.
        assertEquals(
            ApplyState.EXPIRED,
            ApplyState.at("crowd.reports", expires, expires.plusSeconds(1)),
        )
    }

    @Test
    fun `string overload parses RFC 3339 and agrees with the Instant overload`() {
        assertEquals(
            ApplyState.EXPIRED,
            ApplyState.at("official.tdx", "2026-09-01T08:00:00Z", expires.plusSeconds(1)),
        )
        assertEquals(
            ApplyState.CURRENT,
            ApplyState.at("official.tdx", "2026-09-01T08:00:00Z", issued),
        )
    }

    @Test
    fun `unparseable expiry is treated as no expiry rather than silently expired`() {
        // Hiding data is worse than showing it flagged; shape validation
        // already rejects these before they can reach the database.
        assertEquals(
            ApplyState.CURRENT,
            ApplyState.at("official.tdx", "not-a-timestamp", issued),
        )
        assertEquals(
            ApplyState.CURRENT,
            ApplyState.at("official.tdx", null as String?, issued),
        )
    }
}
