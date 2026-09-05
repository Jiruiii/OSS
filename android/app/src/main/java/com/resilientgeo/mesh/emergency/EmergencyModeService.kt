package com.resilientgeo.mesh.emergency

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Emergency Mode foreground service skeleton (乙, per team-assignments.md).
 *
 * This replaces 甲's earlier stub (docs/jia-task-sequence.md Phase 0.5),
 * which existed only to prove a foreground service survives
 * background/lock-screen on a real device before this skeleton was ready
 * — verified 176s uninterrupted on a Pixel 7. That survival proof is still
 * the reason the heartbeat below exists: it gives 甲 something observable
 * in Logcat/notification to confirm the service is genuinely alive, not a
 * placeholder to delete. Real sync work (peer discovery, transfer
 * scheduling) isn't wired in yet — that lands once 甲's `BleGattTransport`
 * integration and this service's lifecycle are connected, a later task.
 *
 * `MainActivity` starts/stops this service directly from the Emergency
 * Mode switch (`ContextCompat.startForegroundService` / `stopService`) —
 * this class only manages its own notification and lifecycle, it does not
 * decide when it should be running.
 */
class EmergencyModeService : Service() {

    companion object {
        private const val TAG = "ResilientGeoEmergency"
        private const val CHANNEL_ID = "emergency_mode"
        private const val NOTIFICATION_ID = 1
        private const val HEARTBEAT_INTERVAL_MS = 5_000L
    }

    private val scope = CoroutineScope(SupervisorJob())
    private var heartbeatJob: Job? = null
    private var startedAtMillis = 0L

    override fun onCreate() {
        super.onCreate()
        startedAtMillis = System.currentTimeMillis()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification(aliveSeconds = 0))
        Log.i(TAG, "onCreate: foreground service started")

        heartbeatJob = scope.launch {
            var tick = 0
            while (true) {
                delay(HEARTBEAT_INTERVAL_MS)
                tick++
                val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
                Log.i(TAG, "HEARTBEAT tick=$tick alive_s=$aliveSeconds")
                updateNotification(aliveSeconds)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        val aliveSeconds = (System.currentTimeMillis() - startedAtMillis) / 1000
        Log.i(TAG, "onDestroy: service killed after alive_s=$aliveSeconds")
        heartbeatJob?.cancel()
        scope.cancel()
        super.onDestroy()
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

    private fun buildNotification(aliveSeconds: Long): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(EmergencyStatusText.title())
            .setContentText(EmergencyStatusText.contentText(aliveSeconds))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    private fun updateNotification(aliveSeconds: Long) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(aliveSeconds))
    }
}
