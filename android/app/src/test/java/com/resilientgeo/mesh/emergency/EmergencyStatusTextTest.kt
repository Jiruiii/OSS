package com.resilientgeo.mesh.emergency

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EmergencyStatusTextTest {

    @Test
    fun `formats seconds under a minute without a minutes component`() {
        assertEquals(
            "Scanning for peers — none nearby · alive 5s",
            EmergencyStatusText.contentText(5),
        )
    }

    @Test
    fun `formats minutes and seconds once a minute has passed`() {
        assertEquals(
            "Scanning for peers — none nearby · alive 1m 05s",
            EmergencyStatusText.contentText(65),
        )
    }

    @Test
    fun `formats an exact minute boundary with zero seconds`() {
        assertEquals(
            "Scanning for peers — none nearby · alive 2m 00s",
            EmergencyStatusText.contentText(120),
        )
    }

    @Test
    fun `formats zero seconds elapsed`() {
        assertEquals(
            "Scanning for peers — none nearby · alive 0s",
            EmergencyStatusText.contentText(0),
        )
    }

    @Test
    fun `reports a single peer in the singular`() {
        assertEquals("1 peer nearby · alive 10s", EmergencyStatusText.contentText(10, peers = 1))
    }

    @Test
    fun `reports multiple peers`() {
        assertEquals("3 peers nearby · alive 1m 00s", EmergencyStatusText.contentText(60, peers = 3))
    }

    @Test
    fun `distinguishes discovery being off from nobody being nearby`() {
        // The user can act on the first case (turn Bluetooth on) and can't
        // on the second, so they must not read the same.
        assertEquals(
            "Discovery off — check Bluetooth · alive 8s",
            EmergencyStatusText.contentText(8, peers = 0, discoveryActive = false),
        )
    }

    @Test
    fun `rejects negative elapsed time`() {
        assertThrows(IllegalArgumentException::class.java) {
            EmergencyStatusText.contentText(-1)
        }
    }

    @Test
    fun `rejects a negative peer count`() {
        assertThrows(IllegalArgumentException::class.java) {
            EmergencyStatusText.contentText(5, peers = -1)
        }
    }

    @Test
    fun `omits the synced-chunks suffix when nothing has synced yet`() {
        assertEquals(
            "1 peer nearby · alive 10s",
            EmergencyStatusText.contentText(10, peers = 1, chunksSynced = 0),
        )
    }

    @Test
    fun `appends the synced-chunks count once something has synced`() {
        assertEquals(
            "1 peer nearby · alive 10s · 4 chunks synced",
            EmergencyStatusText.contentText(10, peers = 1, chunksSynced = 4),
        )
    }

    @Test
    fun `rejects a negative synced-chunks count`() {
        assertThrows(IllegalArgumentException::class.java) {
            EmergencyStatusText.contentText(5, chunksSynced = -1)
        }
    }
}
