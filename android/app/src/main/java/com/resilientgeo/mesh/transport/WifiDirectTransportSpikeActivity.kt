package com.resilientgeo.mesh.transport

import android.Manifest
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
 * Stage 0 spike harness for [WifiDirectTransport] — ADR-001's fallback
 * bulk-transfer candidate after [NearbyConnectionsTransport] hit a real
 * Google Play Services INTERNAL_ERROR on both test devices. Same shape as
 * NearbyTransportSpikeActivity: discover + connect to one peer, then measure
 * 1MB/10MB send throughput and the interrupt -> resume path.
 *
 * Not the final app UI — a harness to produce numbers for ADR-001.
 */
class WifiDirectTransportSpikeActivity : ComponentActivity() {

    companion object {
        const val EXTRA_AUTO_RUN = "auto_run"
    }

    private lateinit var transport: WifiDirectTransport
    private lateinit var statusText: TextView
    private lateinit var logText: TextView

    private var connection: Connection? = null
    private var discoverJob: Job? = null

    // WifiP2pManager historically requires ACCESS_FINE_LOCATION for peer
    // discovery on API < 33; NEARBY_WIFI_DEVICES covers it on API 33+
    // (declared android:usesPermissionFlags="neverForLocation" in the
    // manifest, so it doesn't imply this app derives location from scans).
    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        if (results.values.all { it }) {
            appendLog("permissions granted")
            startConnectionFlow()
        } else {
            appendLog("permissions denied: $results")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        transport = WifiDirectTransport(applicationContext)

        setContentView(buildUi())

        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            startConnectionFlow()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    /**
     * A group owner never sees its own already-associated client through
     * discover() (see WifiDirectTransport.acceptAsGroupOwner's doc), so this
     * checks the device's current role first: GO goes straight to
     * acceptAsGroupOwner(), everyone else falls back to the normal
     * discover() -> connect() path.
     */
    private fun startConnectionFlow() {
        lifecycleScope.launch {
            appendLog("querying current connection info...")
            val info = try {
                transport.queryCurrentConnectionInfo()
            } catch (e: Exception) {
                appendLog("QUERY_RESULT failed: ${e.message}")
                null
            }
            if (info != null) {
                appendLog("QUERY_RESULT groupFormed=${info.groupFormed} isGroupOwner=${info.isGroupOwner} groupOwnerAddress=${info.groupOwnerAddress}")
            }

            if (info != null && info.groupFormed && info.isGroupOwner) {
                statusText.text = "already group owner, listening for client..."
                try {
                    val established = transport.acceptAsGroupOwner()
                    connection = established
                    statusText.text = "connected (as group owner)"
                    appendLog("CONNECTED as group owner")
                    if (intent.getBooleanExtra(EXTRA_AUTO_RUN, false)) {
                        runAutoSequence()
                    }
                } catch (e: Exception) {
                    appendLog("acceptAsGroupOwner failed: ${e.message}")
                }
            } else {
                startDiscovery()
            }
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
        val queryConnectionInfo = Button(this).apply {
            text = "Query current connection info (diagnostic)"
            setOnClickListener { runQueryConnectionInfo() }
        }
        sendButtons.addView(queryConnectionInfo)
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
                    if (intent.getBooleanExtra(EXTRA_AUTO_RUN, false)) {
                        runAutoSequence()
                    }
                } catch (e: Exception) {
                    appendLog("connect failed: ${e.message}")
                }
            }
        }
    }

    /**
     * Driven via `adb shell am start ... --ez auto_run true` so the full
     * connect -> 1MB -> 10MB -> interrupt/resume sequence can be exercised
     * without physically tapping buttons on the device.
     */
    private suspend fun runAutoSequence() {
        val conn = connection ?: return
        appendLog("AUTO_RUN: sending 1MB")
        logTransferResult("AUTO SEND 1MB", transport.send(conn, randomPayload(1_048_576)))

        appendLog("AUTO_RUN: sending 10MB")
        logTransferResult("AUTO SEND 10MB", transport.send(conn, randomPayload(10 * 1_048_576)))

        appendLog("AUTO_RUN: sending 10MB with forced interrupt")
        val payload = randomPayload(10 * 1_048_576)
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

    private fun runQueryConnectionInfo() {
        lifecycleScope.launch {
            appendLog("querying current connection info...")
            val line = try {
                val info = transport.queryCurrentConnectionInfo()
                "QUERY_RESULT groupFormed=${info.groupFormed} isGroupOwner=${info.isGroupOwner} groupOwnerAddress=${info.groupOwnerAddress}"
            } catch (e: Exception) {
                "QUERY_RESULT failed: ${e.message}"
            }
            appendLog(line)
        }
    }

    private fun runSend(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes...")
            val payload = randomPayload(sizeBytes)
            val result = transport.send(conn, payload)
            logTransferResult("SEND", result)
        }
    }

    private fun runSendWithInterrupt(sizeBytes: Int) {
        val conn = connection ?: run { appendLog("not connected yet"); return }
        lifecycleScope.launch {
            appendLog("sending $sizeBytes bytes with a forced mid-transfer interrupt...")
            val payload = randomPayload(sizeBytes)

            // Coarse timing-based approximation of "interrupt at ~50%": this
            // transport writes in 64KB chunks and checks the flag between
            // chunks, so the exact interruption point depends on throughput,
            // not a precise byte count set here.
            val interruptJob = launch {
                delay(150)
                transport.interruptRequested = true
            }

            val firstAttempt = transport.send(conn, payload)
            interruptJob.cancel()
            logTransferResult("SEND (pre-interrupt)", firstAttempt)

            if (firstAttempt is TransferResult.Interrupted) {
                appendLog("resuming from offset=${firstAttempt.bytesTransferred}...")
                val resumed = transport.resume(conn, payload, firstAttempt.bytesTransferred)
                logTransferResult("RESUME", resumed)
            } else {
                appendLog("transfer completed before the interrupt fired — nothing to resume; try again or shorten the delay")
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
        Log.i("ResilientGeoWifiDirect", "TRANSFER_RESULT $line")
        appendLog(line)
    }

    private fun appendLog(line: String) {
        Log.i("ResilientGeoWifiDirect", "UI_LOG $line")
        runOnUiThread { logText.append("$line\n") }
    }

    override fun onDestroy() {
        discoverJob?.cancel()
        connection?.let { c -> lifecycleScope.launch { transport.close(c) } }
        transport.teardown()
        super.onDestroy()
    }
}
