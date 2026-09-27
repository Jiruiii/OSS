package com.resilientgeo.mesh.emergency

import org.junit.Assert.*
import org.junit.Test

class SyncTelemetryTest {
    @Test fun `stale or previous process counters cannot imply a live service`() {
        val telemetry = SyncTelemetry()
        assertFalse(telemetry.snapshot(100).serviceRunning)
        telemetry.start(100)
        telemetry.update(true, 2, AutoPeerSyncEngine.Stats(3, 4, 1), 200)
        val current = telemetry.snapshot(20200)
        assertTrue(current.serviceRunning)
        assertEquals(4, current.chunksReceived)
        assertEquals(3, current.syncCompletions)
        assertFalse(telemetry.snapshot(20201).serviceRunning)
        assertEquals(0, telemetry.snapshot(20201).nearbyPeers)
        assertFalse(SyncTelemetry().snapshot(300).serviceRunning)
        telemetry.stop()
        telemetry.update(true, 2, AutoPeerSyncEngine.Stats(3, 4, 1), 300)
        assertFalse(telemetry.snapshot(300).serviceRunning)
        telemetry.start(400)
        assertEquals(0, telemetry.snapshot(400).chunksReceived)
    }
}
