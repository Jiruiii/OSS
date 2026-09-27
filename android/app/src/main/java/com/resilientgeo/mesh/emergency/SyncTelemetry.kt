package com.resilientgeo.mesh.emergency

/** Process-local counters. A stale heartbeat must not imply a running service. */
class SyncTelemetry {
    data class Snapshot(
        val serviceRunning: Boolean = false,
        val discoveryActive: Boolean = false,
        val nearbyPeers: Int = 0,
        val activeSessions: Int = 0,
        val syncCompletions: Int = 0,
        val chunksReceived: Int = 0,
        val heartbeatElapsedMillis: Long = 0,
    )
    private var state = Snapshot()
    @Synchronized fun start(elapsed: Long) { state = Snapshot(serviceRunning = true, heartbeatElapsedMillis = elapsed) }
    @Synchronized fun stop() { state = Snapshot() }
    @Synchronized fun update(discovery: Boolean, nearby: Int, stats: AutoPeerSyncEngine.Stats?, elapsed: Long) {
        if (!state.serviceRunning) return
        state = Snapshot(true, discovery, nearby, stats?.activeSessions ?: 0, stats?.peersSynced ?: 0, stats?.chunksApplied ?: 0, elapsed)
    }
    @Synchronized fun snapshot(elapsed: Long): Snapshot =
        if (state.serviceRunning && elapsed - state.heartbeatElapsedMillis in 0..20_000) state else Snapshot()
}
