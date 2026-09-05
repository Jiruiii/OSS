package com.resilientgeo.mesh.emergency

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EmergencyStatusTextTest {

    @Test
    fun `formats seconds under a minute without a minutes component`() {
        assertEquals("Background sync standby — alive 5s", EmergencyStatusText.contentText(5))
    }

    @Test
    fun `formats minutes and seconds once a minute has passed`() {
        assertEquals("Background sync standby — alive 1m 05s", EmergencyStatusText.contentText(65))
    }

    @Test
    fun `formats an exact minute boundary with zero seconds`() {
        assertEquals("Background sync standby — alive 2m 00s", EmergencyStatusText.contentText(120))
    }

    @Test
    fun `formats zero seconds elapsed`() {
        assertEquals("Background sync standby — alive 0s", EmergencyStatusText.contentText(0))
    }

    @Test
    fun `rejects negative elapsed time`() {
        assertThrows(IllegalArgumentException::class.java) {
            EmergencyStatusText.contentText(-1)
        }
    }
}
