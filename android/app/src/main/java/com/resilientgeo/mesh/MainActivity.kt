package com.resilientgeo.mesh

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.resilientgeo.mesh.bridge.FlutterMapBridge
import com.resilientgeo.mesh.bridge.SharedPreferencesEmergencyModeState
import com.resilientgeo.mesh.emergency.EmergencyModeService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

/**
 * Flutter map launcher.
 *
 * Android-owned Room, trust verification, TTL/version handling, Emergency
 * Mode, BLE, and transport activities remain in their existing classes. The
 * bridge is registered here, while the native transport activities remain
 * developer harnesses rather than end-user map-screen content.
 */
class MainActivity : FlutterActivity() {

    private var mapBridge: FlutterMapBridge? = null

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* EmergencyModeService already started either way. */ }

    /** Restart discovery after the user grants BLE permissions. */
    private val blePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        if (granted.values.any { it } && emergencyModeEnabled()) {
            stopService(Intent(this, EmergencyModeService::class.java))
            ContextCompat.startForegroundService(
                this,
                Intent(this, EmergencyModeService::class.java),
            )
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        mapBridge?.close()
        mapBridge = FlutterMapBridge(
            applicationContext,
            flutterEngine.dartExecutor.binaryMessenger,
            onEmergencyModeChanged = ::onEmergencyModeChanged,
        )
    }

    override fun onDestroy() {
        mapBridge?.close()
        mapBridge = null
        super.onDestroy()
    }

    private fun onEmergencyModeChanged(enabled: Boolean) {
        if (!enabled) return

        requestBlePermissionsIfNeeded()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestBlePermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val needed = listOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) blePermissionLauncher.launch(needed.toTypedArray())
    }

    private fun emergencyModeEnabled(): Boolean =
        SharedPreferencesEmergencyModeState(applicationContext).isEnabled
}
