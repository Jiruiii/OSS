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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom

/**
 * Stage 0 spike harness for [BleGattTransport] — ADR-001's third
 * bulk-transfer candidate, after Nearby Connections and raw Wi-Fi Direct
 * sockets both hit unresolved platform-level blockers on the test devices
 * (both rejected implementations are now deleted; the measurement record
 * is in docs/adr/ADR-001-transport-layer.md).
 *
 * Test sizes here (10KB/100KB) are deliberately much smaller than the
 * 1MB/10MB the now-deleted Nearby/Wi-Fi-Direct harnesses used: BLE GATT writes are issued one at
 * a time (no write pipelining), so throughput is round-trip-latency bound,
 * not MTU bound — 10MB would take an impractically long time for a spike.
 * KB-scale is also what this project's actual event/chunk payloads look
 * like (see schemas/), so it's the size that actually matters.
 *
 * Not the final app UI — a harness to produce numbers for ADR-001.
 */
class BleGattTransportSpikeActivity : ComponentActivity() {

    companion object {
        const val EXTRA_AUTO_RUN = "auto_run"
    }

    private lateinit var transport: BleGattTransport
    private lateinit var statusText: TextView
    private lateinit var logText: TextView

    private var connection: Connection? = null
    private var discoverJob: Job? = null

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

        setContentView(buildUi())

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

        val sendButtons = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val send10kb = Button(this).apply {
            text = "Send 10KB"
            setOnClickListener { runSend(sizeBytes = 10 * 1024) }
        }
        val send100kb = Button(this).apply {
            text = "Send 100KB"
            setOnClickListener { runSend(sizeBytes = 100 * 1024) }
        }
        val send100kbInterrupt = Button(this).apply {
            text = "Send 100KB + interrupt at ~50% + resume"
            setOnClickListener { runSendWithInterrupt(sizeBytes = 100 * 1024) }
        }
        sendButtons.addView(send10kb)
        sendButtons.addView(send100kb)
        sendButtons.addView(send100kbInterrupt)

        logText = TextView(this).apply {
            text = ""
            textSize = 13f
            setTextIsSelectable(true)
        }
        val logScroll = ScrollView(this).apply { addView(logText) }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(padding, padding, padding, padding)
            addView(statusText)
            addView(sendButtons)
            addView(logScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }

    private fun startDiscovery() {
        statusText.text = "advertising + discovering..."
        discoverJob?.cancel()
        discoverJob = lifecycleScope.launch {
            transport.discover().collect { advertisement ->
                if (connection != null) return@collect
                appendLog("found peer=${advertisement.peerId}, connecting...")
                try {
                    val established = transport.connect(advertisement.peerId)
                    connection = established
                    statusText.text = "connected to ${established.peerId}"
                    appendLog("CONNECTED peer=${established.peerId}")
                    if (intent.getBooleanExtra(EXTRA_AUTO_RUN, false)) {
                        runAutoSequence()
                    }
                } catch (e: Exception) {
                    appendLog("connect failed: ${e.message}")
                }
            }
        }
    }

    private suspend fun runAutoSequence() {
        val conn = connection ?: return
        appendLog("AUTO_RUN: sending 10KB")
        logTransferResult("AUTO SEND 10KB", transport.send(conn, randomPayload(10 * 1024)))

        appendLog("AUTO_RUN: sending 100KB")
        logTransferResult("AUTO SEND 100KB", transport.send(conn, randomPayload(100 * 1024)))

        appendLog("AUTO_RUN: sending 100KB with forced interrupt")
        val payload = randomPayload(100 * 1024)
        val interruptJob = lifecycleScope.launch {
            delay(150)
            transport.interruptRequested = true
        }
        val firstAttempt = transport.send(conn, payload)
        interruptJob.cancel()
        logTransferResult("AUTO SEND (pre-interrupt)", firstAttempt)
        if (firstAttempt is TransferResult.Interrupted) {
            appendLog("AUTO_RUN: resuming from offset=${firstAttempt.bytesTransferred}")
            logTransferResult("AUTO RESUME", transport.resume(conn, payload, firstAttempt.bytesTransferred))
        } else {
            appendLog("AUTO_RUN: completed before interrupt fired, nothing to resume")
        }
        appendLog("AUTO_RUN: done")
    }

    private fun runSend(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes...")
            val result = transport.send(conn, randomPayload(sizeBytes))
            logTransferResult("SEND", result)
        }
    }

    private fun runSendWithInterrupt(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes with a forced mid-transfer interrupt...")
            val payload = randomPayload(sizeBytes)
            val interruptJob = launch {
                delay(150)
                transport.interruptRequested = true
            }
            val firstAttempt = transport.send(conn, payload)
            interruptJob.cancel()
            logTransferResult("SEND (pre-interrupt)", firstAttempt)
            if (firstAttempt is TransferResult.Interrupted) {
                appendLog("resuming from offset=${firstAttempt.bytesTransferred}...")
                logTransferResult("RESUME", transport.resume(conn, payload, firstAttempt.bytesTransferred))
            } else {
                appendLog("transfer completed before the interrupt fired — nothing to resume")
            }
        }
    }

    private fun randomPayload(sizeBytes: Int): ByteArray {
        val bytes = ByteArray(sizeBytes)
        SecureRandom().nextBytes(bytes)
        return bytes
    }

    private fun logTransferResult(label: String, result: TransferResult) {
        val line = when (result) {
            is TransferResult.Success -> {
                val seconds = result.durationMillis.coerceAtLeast(1) / 1000.0
                val bytesPerSec = (result.bytesTransferred / seconds).toLong()
                "$label SUCCESS bytes=${result.bytesTransferred} durationMs=${result.durationMillis} throughputBps=$bytesPerSec"
            }
            is TransferResult.Interrupted -> "$label INTERRUPTED bytesTransferred=${result.bytesTransferred} reason=${result.reason}"
            is TransferResult.Failed -> "$label FAILED reason=${result.reason}"
        }
        Log.i("ResilientGeoBleGatt", "TRANSFER_RESULT $line")
        appendLog(line)
    }

    private fun appendLog(line: String) {
        Log.i("ResilientGeoBleGatt", "UI_LOG $line")
        runOnUiThread { logText.append("$line\n") }
    }

    override fun onDestroy() {
        discoverJob?.cancel()
        connection?.let { c -> lifecycleScope.launch { transport.close(c) } }
        transport.teardown()
        super.onDestroy()
    }
}
