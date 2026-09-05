package com.resilientgeo.mesh.transport

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.text.InputType
import android.util.Log
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.security.SecureRandom
import kotlin.math.abs

/**
 * Phase 0 measurement harness for docs/jia-task-sequence.md items 1/3/4 —
 * all three reuse the already-verified [BleGattTransport] as-is (random
 * payloads, no protocol logic) and only add instrumentation on top:
 *
 * 1. Contact window: how many bytes actually fit (connect + transfer) inside
 *    a simulated 10-60s opportunistic contact, feeding back into ADR-001's
 *    targetSizeBytes discussion.
 * 2. Connection success rate: N repeated connect/close cycles, split by
 *    screen state (PowerManager.isInteractive), for ADR-001's "Connection
 *    success" row.
 * 3. Energy capture: samples BatteryManager.BATTERY_PROPERTY_CURRENT_NOW +
 *    battery voltage once a second while scanning/transferring, writing an
 *    `elapsed_s,power_mw` CSV for module B to analyze later.
 *
 * Discovery is started once in the background and left running for the
 * whole activity lifetime (unlike BleGattTransportSpikeActivity, this does
 * NOT auto-connect on peer-found) so each test controls its own connect
 * timing instead of racing a background auto-connect.
 *
 * Cross-device compatibility (item 2 in jia-task-sequence.md) needs no new
 * code — it's this same harness (or BleGattTransportSpikeActivity) rerun on
 * the non-Pixel device from C_BLEbroadcast.md.
 */
class BleGattMeasurementActivity : ComponentActivity() {

    companion object {
        private const val TAG = "ResilientGeoBleMeasure"

        // Mirrors pipeline/lib/bundle.mjs's current targetSizeBytes default —
        // this is exactly the number the contact-window test exists to
        // sanity-check, not just an arbitrary chunk size.
        private const val CHUNK_SIZE_BYTES = 4096
    }

    private lateinit var transport: BleGattTransport
    private lateinit var powerManager: PowerManager
    private lateinit var batteryManager: BatteryManager

    private lateinit var statusText: TextView
    private lateinit var logText: TextView
    private lateinit var connectionRateInput: EditText
    private lateinit var energyDurationInput: EditText

    private var discoverJob: Job? = null
    @Volatile private var discoveredPeerId: String? = null

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        if (results.values.all { it }) {
            appendLog("permissions granted")
            startDiscovery()
        } else {
            appendLog("permissions denied: $results")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bluetoothManager = getSystemService(BluetoothManager::class.java)
        transport = BleGattTransport(applicationContext, bluetoothManager.adapter)
        powerManager = getSystemService(PowerManager::class.java)
        batteryManager = getSystemService(BatteryManager::class.java)

        setContentView(buildUi())
        appendLog("device=${Build.MANUFACTURER} ${Build.MODEL} api=${Build.VERSION.SDK_INT}")

        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            startDiscovery()
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

        val windowButtons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@BleGattMeasurementActivity).apply {
                text = "10s"
                setOnClickListener { runContactWindowTest(10) }
            })
            addView(Button(this@BleGattMeasurementActivity).apply {
                text = "30s"
                setOnClickListener { runContactWindowTest(30) }
            })
            addView(Button(this@BleGattMeasurementActivity).apply {
                text = "60s"
                setOnClickListener { runContactWindowTest(60) }
            })
        }

        connectionRateInput = EditText(this).apply {
            setText("20")
            hint = "iterations"
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        val runRateButton = Button(this).apply {
            text = "Run N connect/close cycles"
            setOnClickListener {
                val n = connectionRateInput.text.toString().toIntOrNull() ?: 20
                runConnectionRateTest(n)
            }
        }

        energyDurationInput = EditText(this).apply {
            setText("60")
            hint = "seconds"
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        val runEnergyButton = Button(this).apply {
            text = "Start energy capture"
            setOnClickListener {
                val secs = energyDurationInput.text.toString().toIntOrNull() ?: 60
                runEnergyCapture(secs)
            }
        }

        logText = TextView(this).apply {
            text = ""
            textSize = 13f
            setTextIsSelectable(true)
        }
        val logScroll = ScrollView(this).apply { addView(logText) }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            addView(statusText)
            addView(sectionLabel("1. Contact window (connect + transfer within a simulated opportunistic contact)"))
            addView(windowButtons)
            addView(sectionLabel("2. Connection success rate"))
            addView(connectionRateInput)
            addView(runRateButton)
            addView(sectionLabel("3. Energy capture (elapsed_s,power_mw CSV)"))
            addView(energyDurationInput)
            addView(runEnergyButton)
            addView(logScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }

    private fun sectionLabel(label: String): TextView {
        val topMargin = (12 * resources.displayMetrics.density).toInt()
        return TextView(this).apply {
            text = label
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, topMargin, 0, 4)
        }
    }

    private fun startDiscovery() {
        statusText.text = "advertising + scanning in background..."
        discoverJob?.cancel()
        discoverJob = lifecycleScope.launch {
            transport.discover().collect { advertisement ->
                if (discoveredPeerId == null) {
                    discoveredPeerId = advertisement.peerId
                    statusText.text = "peer discovered: ${advertisement.peerId}"
                    appendLog("peer discovered: ${advertisement.peerId}")
                }
            }
        }
    }

    // --- 1. Contact window ---

    private fun runContactWindowTest(windowSeconds: Int) {
        val peerId = discoveredPeerId ?: run { appendLog("no peer discovered yet"); return }
        lifecycleScope.launch {
            appendLog("=== CONTACT_WINDOW window_s=$windowSeconds peer=$peerId ===")
            val contactStart = System.currentTimeMillis()
            val deadline = contactStart + windowSeconds * 1000L

            val connection = try {
                transport.connect(peerId)
            } catch (e: Exception) {
                val connectMs = System.currentTimeMillis() - contactStart
                appendLog("CONTACT_WINDOW_RESULT window_s=$windowSeconds connect_ms=$connectMs " +
                    "outcome=connect_failed bytes_acked=0 error=${e.message}")
                return@launch
            }
            val connectMs = System.currentTimeMillis() - contactStart
            appendLog("connected in ${connectMs}ms")

            val remainingMs = deadline - System.currentTimeMillis()
            if (remainingMs <= 0) {
                appendLog("CONTACT_WINDOW_RESULT window_s=$windowSeconds connect_ms=$connectMs " +
                    "outcome=handshake_exceeded_window bytes_acked=0")
                transport.close(connection)
                return@launch
            }

            var bytesAcked = 0L
            var bytesInFlightUnacked = 0L
            var failureReason: String? = null
            val transferStart = System.currentTimeMillis()
            val cutoffJob = launch {
                delay(remainingMs)
                transport.interruptRequested = true
            }
            while (System.currentTimeMillis() < deadline) {
                when (val result = transport.send(connection, randomPayload(CHUNK_SIZE_BYTES))) {
                    is TransferResult.Success -> {
                        bytesAcked += result.bytesTransferred
                        appendLog("chunk acked +${result.bytesTransferred}B (total=$bytesAcked)")
                    }
                    is TransferResult.Interrupted -> {
                        bytesInFlightUnacked = result.bytesTransferred
                        appendLog("chunk cut off at window edge: +${bytesInFlightUnacked}B in-flight, unacked")
                    }
                    is TransferResult.Failed -> {
                        failureReason = result.reason
                        appendLog("chunk failed: ${result.reason}")
                    }
                }
                if (failureReason != null) break
            }
            cutoffJob.cancel()
            transport.interruptRequested = false
            val transferMs = System.currentTimeMillis() - transferStart
            transport.close(connection)

            val throughputBps = if (transferMs > 0) (bytesAcked * 1000 / transferMs) else 0
            appendLog(
                "CONTACT_WINDOW_RESULT window_s=$windowSeconds connect_ms=$connectMs " +
                    "outcome=${if (failureReason != null) "transfer_failed:$failureReason" else "ok"} " +
                    "bytes_acked=$bytesAcked bytes_inflight_unacked=$bytesInFlightUnacked " +
                    "transfer_ms=$transferMs throughput_bps=$throughputBps",
            )
        }
    }

    // --- 2. Connection success rate ---

    private data class ConnectAttempt(
        val index: Int,
        val screenInteractive: Boolean,
        val success: Boolean,
        val latencyMs: Long,
        val error: String?,
    )

    private fun runConnectionRateTest(iterations: Int) {
        val peerId = discoveredPeerId ?: run { appendLog("no peer discovered yet"); return }
        lifecycleScope.launch {
            appendLog("=== CONNECTION_RATE n=$iterations peer=$peerId ===")
            val attempts = mutableListOf<ConnectAttempt>()
            repeat(iterations) { i ->
                val screenOn = powerManager.isInteractive
                val start = System.currentTimeMillis()
                val attempt = try {
                    val conn = transport.connect(peerId)
                    transport.close(conn)
                    ConnectAttempt(i, screenOn, true, System.currentTimeMillis() - start, null)
                } catch (e: Exception) {
                    ConnectAttempt(i, screenOn, false, System.currentTimeMillis() - start, e.message)
                }
                attempts += attempt
                appendLog(
                    "CONN_ATTEMPT idx=${attempt.index} screen=${if (attempt.screenInteractive) "on" else "locked_or_off"} " +
                        "success=${attempt.success} latency_ms=${attempt.latencyMs}" +
                        (attempt.error?.let { " error=$it" } ?: ""),
                )
                delay(1000)
            }
            logConnectionRateSummary(attempts)
        }
    }

    private fun logConnectionRateSummary(attempts: List<ConnectAttempt>) {
        appendLog("--- CONNECTION_RATE_SUMMARY ---")
        for ((screenOn, group) in attempts.groupBy { it.screenInteractive }) {
            val successes = group.filter { it.success }
            val rate = successes.size * 100.0 / group.size
            val latencies = successes.map { it.latencyMs }.sorted()
            val label = if (screenOn) "screen_on" else "screen_locked_or_off"
            appendLog(
                "CONNECTION_RATE_RESULT segment=$label n=${group.size} success=${successes.size} " +
                    "rate=${"%.1f".format(rate)}% latency_p50_ms=${percentile(latencies, 50.0)} " +
                    "latency_p95_ms=${percentile(latencies, 95.0)}",
            )
        }
        val overallSuccesses = attempts.count { it.success }
        val overallRate = overallSuccesses * 100.0 / attempts.size
        appendLog(
            "CONNECTION_RATE_RESULT segment=overall n=${attempts.size} success=$overallSuccesses " +
                "rate=${"%.1f".format(overallRate)}%",
        )
    }

    private fun percentile(sorted: List<Long>, p: Double): Long {
        if (sorted.isEmpty()) return -1
        val idx = ((p / 100.0) * (sorted.size - 1)).toInt().coerceIn(0, sorted.size - 1)
        return sorted[idx]
    }

    // --- 3. Energy capture ---

    private fun runEnergyCapture(durationSeconds: Int) {
        lifecycleScope.launch {
            appendLog("=== ENERGY_CAPTURE duration_s=$durationSeconds ===")
            appendLog(
                "note: BATTERY_PROPERTY_CURRENT_NOW's sign convention (positive/negative for " +
                    "charging/discharging) varies by OEM; this logs the magnitude only.",
            )

            val peerId = discoveredPeerId
            val connection = if (peerId != null) {
                try {
                    transport.connect(peerId)
                } catch (e: Exception) {
                    appendLog("connect failed, capturing scan-only power draw: ${e.message}")
                    null
                }
            } else {
                appendLog("no peer discovered yet, capturing scan-only power draw")
                null
            }

            val transferJob = connection?.let { conn ->
                launch {
                    while (isActive) {
                        val result = transport.send(conn, randomPayload(CHUNK_SIZE_BYTES))
                        if (result is TransferResult.Failed) {
                            appendLog("energy-capture transfer failed: ${result.reason}")
                            break
                        }
                    }
                }
            }

            val file = File(getExternalFilesDir(null), "energy_${System.currentTimeMillis()}.csv")
            file.bufferedWriter().use { writer ->
                writer.write("elapsed_s,power_mw\n")
                val startMs = System.currentTimeMillis()
                while (System.currentTimeMillis() - startMs < durationSeconds * 1000L) {
                    val elapsedS = (System.currentTimeMillis() - startMs) / 1000.0
                    val powerMw = samplePowerMw()
                    writer.write("${"%.1f".format(elapsedS)},${"%.2f".format(powerMw)}\n")
                    writer.flush()
                    appendLog("t=${"%.1f".format(elapsedS)}s power=${"%.1f".format(powerMw)}mW")
                    delay(1000)
                }
            }

            transferJob?.cancel()
            connection?.let { transport.close(it) }
            appendLog("ENERGY_CAPTURE_RESULT file=${file.absolutePath}")
            appendLog("pull it with: adb pull ${file.absolutePath}")
        }
    }

    private fun samplePowerMw(): Double {
        val currentUa = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
        val voltageMv = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) ?: 0
        return abs(currentUa.toDouble() * voltageMv.toDouble()) / 1_000_000.0
    }

    private fun randomPayload(sizeBytes: Int): ByteArray {
        val bytes = ByteArray(sizeBytes)
        SecureRandom().nextBytes(bytes)
        return bytes
    }

    private fun appendLog(line: String) {
        Log.i(TAG, line)
        runOnUiThread { logText.append("$line\n") }
    }

    override fun onDestroy() {
        discoverJob?.cancel()
        transport.teardown()
        super.onDestroy()
    }
}
