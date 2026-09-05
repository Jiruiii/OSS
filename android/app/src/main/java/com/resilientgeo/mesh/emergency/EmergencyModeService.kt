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
import com.resilientgeo.mesh.transport.BleDiscovery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Emergency Mode foreground service: keeps peer discovery running while the
 * screen is off and the phone is in someone's pocket.
 *
 * This service exists because of a measurement, not a guess. ADR-001's
 * connection-success runs found **0/19 successful BLE connections with the
 * screen locked** for an ordinary app, against 17/20 with the screen on —
 * so without a foreground service holding the process up, store-carry-
 * forward simply cannot happen while someone walks between two groups of
 * people, which is the entire premise of the project.
 *
 * ### What it does and does not do
 *
 * It runs the discovery half of the transport: BLE advertise so other nodes
 * can see this one, and a filtered scan so this one sees them, reporting
 * the live peer count in its notification. It does **not** yet open GATT
 * connections or run HELLO/DIFF/REQUEST on its own — automatic role
 * negotiation between two peers that meet unattended is genuinely unsolved
 * here (`PeerSyncMilestoneActivity` still needs a human to pick which
 * device is requester and which is server), and shipping a half-working
 * auto-sync would be worse than being precise about the boundary. Actual
 * chunk exchange is still operator-driven from that screen.
 *
 * `MainActivity` starts and stops this service from the Emergency Mode
 * switch; this class only manages its own lifecycle and notification.
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

    /** peer address -> last time its advertisement was seen. */
    private val peersLastSeen = ConcurrentHashMap<String, Long>()

    private var discovery: BleDiscovery? = null
    private var discoveryActive = false

    override fun onCreate() {
        super.onCreate()
        startedAtMillis = System.currentTimeMillis()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification(aliveSeconds = 0, peers = 0))
        Log.i(TAG, "onCreate: foreground service started")

        startDiscovery()

        heartbeatJob = scope.launch {
            var tick = 0
            while (true) {
                delay(HEARTBEAT_INTERVAL_MS)
                tick++
                val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
                val peers = activePeerCount()
                // Kept at INFO: this line is what the lock-screen survival
                // runs in ADR-001 grep for to prove the process is alive.
                Log.i(TAG, "HEARTBEAT tick=$tick alive_s=$aliveSeconds peers=$peers discovery=$discoveryActive")
                updateNotification(aliveSeconds, peers)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
        Log.i(TAG, "onDestroy: service stopping after alive_s=$aliveSeconds")
        stopDiscovery()
        heartbeatJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun startDiscovery() {
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

        val ble = BleDiscovery(adapter)
        discovery = ble
        runCatching {
            ble.startAdvertising()
            ble.startScanning { advertisement ->
                peersLastSeen[advertisement.peerId] = advertisement.discoveredAtMillis
            }
            discoveryActive = true
            Log.i(TAG, "discovery started (advertise + filtered scan)")
        }.onFailure { error ->
            // A SecurityException here means permissions were revoked
            // between the check above and the call. Degrade to the
            // process-alive-only mode rather than crashing the service.
            discoveryActive = false
            Log.e(TAG, "failed to start discovery: ${error.message}")
        }
    }

    private fun stopDiscovery() {
        val ble = discovery ?: return
        runCatching {
            ble.stopScanning()
            ble.stopAdvertising()
        }.onFailure { error -> Log.w(TAG, "error stopping discovery: ${error.message}") }
        discovery = null
        discoveryActive = false
    }

    private fun activePeerCount(): Int {
        val cutoff = System.currentTimeMillis() - PEER_STALE_AFTER_MS
        peersLastSeen.entries.removeIf { it.value < cutoff }
        return peersLastSeen.size
    }

    private fun hasBluetoothPermissions(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE)
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

    private fun buildNotification(aliveSeconds: Long, peers: Int): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(EmergencyStatusText.title())
            .setContentText(EmergencyStatusText.contentText(aliveSeconds, peers, discoveryActive))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    private fun updateNotification(aliveSeconds: Long, peers: Int) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(aliveSeconds, peers))
    }
}
