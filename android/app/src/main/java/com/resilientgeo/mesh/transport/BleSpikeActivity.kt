package com.resilientgeo.mesh.transport

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * Minimal harness activity: request the BLE permissions, then start
 * advertising + scanning and watch Logcat (tag "ResilientGeoBle").
 *
 * Also renders discovery results on-screen (peer id, RSSI, latency since
 * this run's scan started) so two people running this on two phones don't
 * need to tether to Android Studio's Logcat to read results out loud to
 * each other. Every "DISCOVERY_LATENCY" line is still also logged, in case
 * you want to pull the raw numbers via `adb logcat` afterwards. The
 * "Restart scan" button resets the scan-start clock and the seen-peers set
 * so you can run repeated trials (ADR-001 wants p50/p95 over >=5 runs)
 * without reinstalling the app.
 *
 * This is scaffolding for the Stage 0 spike, not the final app UI — B will
 * eventually own the real Android UI once transport is proven.
 */
class BleSpikeActivity : ComponentActivity() {

    private lateinit var bleDiscovery: BleDiscovery
    private lateinit var statusText: TextView
    private lateinit var logText: TextView

    private var scanStartedAtMillis: Long = 0L
    private val seenPeerIds = mutableSetOf<String>()

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
            statusText.text = "permissions denied: $results"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val bluetoothManager = getSystemService(BluetoothManager::class.java)
        bleDiscovery = BleDiscovery(bluetoothManager.adapter)

        setContentView(buildUi())

        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            startSpike()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun buildUi(): LinearLayout {
        val padding = (16 * resources.displayMetrics.density).toInt()

        statusText = TextView(this).apply {
            text = "requesting permissions..."
            textSize = 16f
            setPadding(0, 0, 0, padding)
        }

        val restartButton = Button(this).apply {
            text = "Restart scan (new trial)"
            setOnClickListener { restartSpike() }
        }

        logText = TextView(this).apply {
            text = ""
            textSize = 13f
            setTextIsSelectable(true)
        }

        val logScroll = ScrollView(this).apply {
            addView(logText)
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(padding, padding, padding, padding)
            addView(statusText)
            addView(restartButton)
            addView(logScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }

    private fun startSpike() {
        scanStartedAtMillis = System.currentTimeMillis()
        seenPeerIds.clear()
        statusText.text = "advertising + scanning since $scanStartedAtMillis"

        bleDiscovery.startAdvertising()
        bleDiscovery.startScanning { advertisement -> onPeerFound(advertisement) }
    }

    private fun restartSpike() {
        bleDiscovery.stopAdvertising()
        bleDiscovery.stopScanning()
        logText.text = ""
        startSpike()
    }

    private fun onPeerFound(advertisement: PeerAdvertisement) {
        // Only record latency for the first sighting of each peer per trial —
        // repeated adverts from an already-seen peer aren't a new discovery event.
        val isFirstSighting = seenPeerIds.add(advertisement.peerId)
        if (!isFirstSighting) return

        val latencyMillis = advertisement.discoveredAtMillis - scanStartedAtMillis
        val line = "peer=${advertisement.peerId} rssi=${advertisement.rssi} latencyMs=$latencyMillis"

        Log.i("ResilientGeoBle", "DISCOVERY_LATENCY $line")
        runOnUiThread {
            logText.append("$line\n")
        }
    }

    override fun onDestroy() {
        bleDiscovery.stopAdvertising()
        bleDiscovery.stopScanning()
        super.onDestroy()
    }
}
