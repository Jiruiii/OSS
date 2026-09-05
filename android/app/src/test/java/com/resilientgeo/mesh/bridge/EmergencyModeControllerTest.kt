package com.resilientgeo.mesh.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EmergencyModeControllerTest {

    @Test
    fun `enabling starts the foreground-service command and records enabled state`() {
        val command = RecordingEmergencyModeServiceCommand()
        val state = InMemoryEmergencyModeState(initialValue = false)
        val controller = EmergencyModeController(command, state)

        assertTrue(controller.setEnabled(true))
        assertEquals(1, command.starts)
        assertEquals(0, command.stops)
        assertTrue(controller.isEnabled)
        assertTrue(state.isEnabled)
    }

    @Test
    fun `disabling stops the foreground-service command and records disabled state`() {
        val command = RecordingEmergencyModeServiceCommand()
        val state = InMemoryEmergencyModeState(initialValue = true)
        val controller = EmergencyModeController(command, state)

        assertFalse(controller.setEnabled(false))
        assertEquals(0, command.starts)
        assertEquals(1, command.stops)
        assertFalse(controller.isEnabled)
        assertFalse(state.isEnabled)
    }

    private class RecordingEmergencyModeServiceCommand : EmergencyModeServiceCommand {
        var starts = 0
        var stops = 0

        override fun start() {
            starts += 1
        }

        override fun stop() {
            stops += 1
        }
    }

    private class InMemoryEmergencyModeState(initialValue: Boolean) : EmergencyModeState {
        override var isEnabled = initialValue
    }
}
