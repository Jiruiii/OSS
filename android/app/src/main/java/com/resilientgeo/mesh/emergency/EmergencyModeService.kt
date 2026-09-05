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
 * Minimal Emergency Mode foreground service stub (docs/jia-task-sequence.md
 * Phase 0.5 / team-assignments.md): 乙 was slated to write the real Service
 * skeleton (notification chrome, lifecycle) but hasn't delivered it yet.
 * Per the "soft dependency" call in jia-task-sequence.md — this isn't
 * something 甲 needs to wait on — this is the smallest thing that proves
 * "does a foreground service actually survive background/lock-screen on a
 * real device", so that question isn't blocked on 乙's timeline. It does no
 * real sync work; it only starts, logs a heartbeat every 5s (visible via
 * logcat and the notification text), and keeps running. When 乙's real
 * version lands, it replaces this class's body, not the survival proof.
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
            .setContentTitle("Emergency Mode active")
            .setContentText("Background sync standby — alive ${aliveSeconds}s")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    private fun updateNotification(aliveSeconds: Long) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(aliveSeconds))
    }
}
