package com.resilientgeo.mesh.transport

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * Minimal harness activity: request the BLE permissions, then start
 * advertising + scanning and watch Logcat (tag "ResilientGeoBle").
 *
 * This is scaffolding for the Stage 0 spike, not the final app UI — B will
 * eventually own the real Android UI once transport is proven.
 */
class BleSpikeActivity : ComponentActivity() {

    private lateinit var bleDiscovery: BleDiscovery

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        } else {
            // Pre-Android 12 needs location permission for BLE scan results to appear at all.
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        val allGranted = results.values.all { it }
        if (allGranted) {
            Log.i("ResilientGeoBle", "permissions granted, starting BLE spike")
            startSpike()
        } else {
            Log.e("ResilientGeoBle", "permissions denied: $results")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val bluetoothManager = getSystemService(BluetoothManager::class.java)
        bleDiscovery = BleDiscovery(bluetoothManager.adapter)

        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            startSpike()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun startSpike() {
        bleDiscovery.startAdvertising()
        bleDiscovery.startScanning { advertisement ->
            Log.i(
                "ResilientGeoBle",
                "discovered peer=${advertisement.peerId} rssi=${advertisement.rssi} " +
                        "at=${advertisement.discoveredAtMillis}",
            )
        }
    }

    override fun onDestroy() {
        bleDiscovery.stopAdvertising()
        bleDiscovery.stopScanning()
        super.onDestroy()
    }
}
