package com.resilientgeo.mesh.emergency

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.resilientgeo.mesh.data.MeshRepository
import com.resilientgeo.mesh.transport.BleGattTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Emergency Mode foreground service: keeps peer discovery *and* automatic
 * chunk sync running while the screen is off and the phone is in someone's
 * pocket.
 *
 * This service exists because of a measurement, not a guess. ADR-001's
 * connection-success runs found **0/19 successful BLE connections with the
 * screen locked** for an ordinary app, against 17/20 with the screen on —
 * so without a foreground service holding the process up, store-carry-
 * forward simply cannot happen while someone walks between two groups of
 * people, which is the entire premise of the project.
 *
 * ### What it does
 *
 * It runs [BleGattTransport] (advertise + scan + GATT client/server) and
 * hands it to an [AutoPeerSyncEngine], which runs HELLO -> DIFF -> REQUEST ->
 * TRANSFER with every peer found, with no human choosing roles — see that
 * class's doc comment for why no role negotiation is actually needed. This
 * replaces the previous discovery-only version, which could see peers'
 * advertisements but never opened a GATT connection or exchanged anything;
 * that gap (`PeerSyncMilestoneActivity` needing a human to pick requester vs
 * server) is what this class now closes for the unattended case.
 *
 * `MainActivity` starts and stops this service from the Emergency Mode
 * switch; this class manages the service lifecycle and notification and
 * otherwise defers to [AutoPeerSyncEngine] and [BleGattTransport].
 */
class EmergencyModeService : Service() {

    companion object {
        private const val TAG = "ResilientGeoEmergency"
        private const val CHANNEL_ID = "emergency_mode"
        private const val NOTIFICATION_ID = 1
        private const val HEARTBEAT_INTERVAL_MS = 5_000L

        /**
         * A peer not re-seen within this window is treated as out of range.
         * BLE advertisements arrive every few hundred ms at
         * ADVERTISE_MODE_LOW_LATENCY, so 30s is many missed intervals — long
         * enough not to flicker when a packet is lost, short enough that the
         * count reflects who is actually nearby.
         */
        private const val PEER_STALE_AFTER_MS = 30_000L
    }

    private val scope = CoroutineScope(SupervisorJob())
    private var heartbeatJob: Job? = null
    private var startedAtMillis = 0L

    private var transport: BleGattTransport? = null
    private var engine: AutoPeerSyncEngine? = null
    private var discoveryActive = false

    private fun activePeerCount(): Int = engine?.visiblePeerCount(PEER_STALE_AFTER_MS) ?: 0

    override fun onCreate() {
        super.onCreate()
        startedAtMillis = System.currentTimeMillis()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification(aliveSeconds = 0, peers = 0, chunksSynced = 0))
        Log.i(TAG, "onCreate: foreground service started")

        startAutoSync()

        heartbeatJob = scope.launch {
            var tick = 0
            while (true) {
                delay(HEARTBEAT_INTERVAL_MS)
                tick++
                val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
                val peers = activePeerCount()
                val stats = engine?.stats()
                // Kept at INFO: this line is what the lock-screen survival
                // runs in ADR-001 grep for to prove the process is alive.
                Log.i(
                    TAG,
                    "HEARTBEAT tick=$tick alive_s=$aliveSeconds peers=$peers discovery=$discoveryActive " +
                        "synced_peers=${stats?.peersSynced ?: 0} chunks_applied=${stats?.chunksApplied ?: 0} " +
                        "active_sessions=${stats?.activeSessions ?: 0}",
                )
                updateNotification(aliveSeconds, peers, stats?.chunksApplied ?: 0)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
        Log.i(TAG, "onDestroy: service stopping after alive_s=$aliveSeconds")
        stopAutoSync()
        heartbeatJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun startAutoSync() {
        if (!hasBluetoothPermissions()) {
            // Not fatal: the service still runs and still holds the process
            // up, it just can't see anyone. The notification says so rather
            // than silently pretending discovery is working.
            Log.w(TAG, "BLE permissions not granted; running without discovery")
            return
        }
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth unavailable or disabled; running without discovery")
            return
        }

        val nodeId = NodeIdentity(applicationContext).nodeId
        val repository = MeshRepository(applicationContext)
        val ble = BleGattTransport(applicationContext, adapter)

        runCatching {
            val syncEngine = AutoPeerSyncEngine(
                transport = ble,
                localNodeId = nodeId,
                localSummaryProvider = { repository.allLocalPeerSummaries(nodeId) },
                chunkProvider = { datasetId, namespace, chunkId -> repository.cachedChunkJson(datasetId, namespace, chunkId) },
                chunkIngestor = { chunk -> repository.ingestChunk(chunk) },
                scope = scope,
                onLog = { line -> Log.i(TAG, "[auto-sync] $line") },
            )
            syncEngine.start()
            transport = ble
            engine = syncEngine
            discoveryActive = true
            Log.i(TAG, "auto-sync started (advertise + scan + automatic HELLO/DIFF/REQUEST/TRANSFER)")
        }.onFailure { error ->
            // A SecurityException here means permissions were revoked
            // between the check above and the call. Degrade to the
            // process-alive-only mode rather than crashing the service.
            discoveryActive = false
            Log.e(TAG, "failed to start auto-sync: ${error.message}")
        }
    }

    private fun stopAutoSync() {
        engine?.stop()
        engine = null
        runCatching { transport?.teardown() }.onFailure { error -> Log.w(TAG, "error tearing down transport: ${error.message}") }
        transport = null
        discoveryActive = false
    }

    private fun hasBluetoothPermissions(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        // BLUETOOTH_CONNECT wasn't required by the discovery-only version
        // this replaced (advertise + scan don't need it), but AutoPeerSyncEngine
        // now actually calls BleGattTransport.connect() -> device.connectGatt(),
        // which throws SecurityException on API 31+ without it.
        return listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
            .all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Emergency Mode",
                NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(aliveSeconds: Long, peers: Int, chunksSynced: Int): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(EmergencyStatusText.title())
            .setContentText(EmergencyStatusText.contentText(aliveSeconds, peers, discoveryActive, chunksSynced))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    private fun updateNotification(aliveSeconds: Long, peers: Int, chunksSynced: Int) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(aliveSeconds, peers, chunksSynced))
    }
}
