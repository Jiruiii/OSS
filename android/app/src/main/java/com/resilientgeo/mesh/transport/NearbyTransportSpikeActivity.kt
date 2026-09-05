package com.resilientgeo.mesh.transport

import android.Manifest
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
 * Stage 0 spike harness for [NearbyConnectionsTransport]: discover + connect
 * to one peer, then measure 1MB/10MB send throughput and exercise the
 * cancel-mid-transfer -> resume path ADR-001 asks for. Companion to
 * BleSpikeActivity, which only covers discovery latency, not bulk transfer.
 *
 * Not the final app UI — a harness to produce numbers for ADR-001.
 */
class NearbyTransportSpikeActivity : ComponentActivity() {

    private lateinit var transport: NearbyConnectionsTransport
    private lateinit var statusText: TextView
    private lateinit var logText: TextView
    private lateinit var sendButtons: LinearLayout

    private var connection: Connection? = null
    private var discoverJob: Job? = null

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.CHANGE_WIFI_STATE,
                Manifest.permission.NEARBY_WIFI_DEVICES,
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.CHANGE_WIFI_STATE,
                Manifest.permission.ACCESS_FINE_LOCATION,
            )
        } else {
            arrayOf(
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.CHANGE_WIFI_STATE,
                Manifest.permission.ACCESS_FINE_LOCATION,
            )
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
        transport = NearbyConnectionsTransport(applicationContext, localName = Build.MODEL ?: "resilientgeo-node")

        setContentView(buildUi())

        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
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

        sendButtons = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            isEnabled = false
        }
        val send1mb = Button(this).apply {
            text = "Send 1MB"
            setOnClickListener { runSend(sizeBytes = 1_048_576) }
        }
        val send10mb = Button(this).apply {
            text = "Send 10MB"
            setOnClickListener { runSend(sizeBytes = 10 * 1_048_576) }
        }
        val send10mbInterrupt = Button(this).apply {
            text = "Send 10MB + interrupt at ~50% + resume"
            setOnClickListener { runSendWithInterrupt(sizeBytes = 10 * 1_048_576) }
        }
        sendButtons.addView(send1mb)
        sendButtons.addView(send10mb)
        sendButtons.addView(send10mbInterrupt)

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
        statusText.text = "discovering..."
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
                } catch (e: Exception) {
                    appendLog("connect failed: ${e.message}")
                }
            }
        }
    }

    private fun runSend(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes...")
            val payload = randomPayload(sizeBytes)
            val result = transport.send(conn, payload)
            logTransferResult("SEND", sizeBytes, result)
        }
    }

    private fun runSendWithInterrupt(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes with a forced mid-transfer cancel...")
            val payload = randomPayload(sizeBytes)

            // Fire-and-forget canceller: give the transfer a moment to start,
            // then cancel it. This is a coarse timing-based approximation of
            // "interrupt at ~50%", not a precise byte-offset trigger — Nearby
            // Connections doesn't expose a way to cancel at an exact byte
            // count, only by payload id, whenever we choose to call it.
            val cancelJob = launch {
                delay(150)
                transport.cancelLastOutboundTransfer()
            }

            val firstAttempt = transport.send(conn, payload)
            cancelJob.cancel()
            logTransferResult("SEND (pre-interrupt)", sizeBytes, firstAttempt)

            if (firstAttempt is TransferResult.Interrupted) {
                appendLog("resuming from offset=${firstAttempt.bytesTransferred}...")
                val resumed = transport.resume(conn, payload, firstAttempt.bytesTransferred)
                logTransferResult("RESUME", sizeBytes - firstAttempt.bytesTransferred.toInt(), resumed)
            } else {
                appendLog("transfer completed before the cancel fired — nothing to resume; try again or shorten the delay")
            }
        }
    }

    private fun randomPayload(sizeBytes: Int): ByteArray {
        val bytes = ByteArray(sizeBytes)
        SecureRandom().nextBytes(bytes)
        return bytes
    }

    private fun logTransferResult(label: String, sizeBytes: Int, result: TransferResult) {
        val line = when (result) {
            is TransferResult.Success -> {
                val seconds = result.durationMillis.coerceAtLeast(1) / 1000.0
                val bytesPerSec = (result.bytesTransferred / seconds).toLong()
                "$label SUCCESS bytes=${result.bytesTransferred} durationMs=${result.durationMillis} throughputBps=$bytesPerSec"
            }
            is TransferResult.Interrupted -> "$label INTERRUPTED bytesTransferred=${result.bytesTransferred} reason=${result.reason}"
            is TransferResult.Failed -> "$label FAILED reason=${result.reason}"
        }
        Log.i("ResilientGeoNearby", "TRANSFER_RESULT $line")
        appendLog(line)
    }

    private fun appendLog(line: String) {
        runOnUiThread { logText.append("$line\n") }
    }

    override fun onDestroy() {
        discoverJob?.cancel()
        connection?.let { c -> lifecycleScope.launch { transport.close(c) } }
        super.onDestroy()
    }
}
