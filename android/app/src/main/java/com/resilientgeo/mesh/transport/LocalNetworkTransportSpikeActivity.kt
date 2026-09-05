package com.resilientgeo.mesh.transport

import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom

/**
 * Stage 0 spike harness for [LocalNetworkTransport] — ADR-001's second
 * fallback (plain Wi-Fi, not WifiP2pManager P2P) after WifiDirectTransport's
 * raw P2P sockets hit a confirmed TCP connect timeout despite a correctly
 * bound, listening ServerSocket and working ICMP. Requires both devices on
 * the same regular Wi-Fi network (one phone's hotspot, or a shared router) —
 * this activity does not create that network itself.
 *
 * Not the final app UI — a harness to produce numbers for ADR-001.
 */
class LocalNetworkTransportSpikeActivity : ComponentActivity() {

    companion object {
        const val EXTRA_AUTO_RUN = "auto_run"
    }

    private lateinit var transport: LocalNetworkTransport
    private lateinit var statusText: TextView
    private lateinit var logText: TextView

    private var connection: Connection? = null
    private var discoverJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val localName = "${Build.MODEL ?: "node"}-${(1000..9999).random()}"
        transport = LocalNetworkTransport(applicationContext, localName)

        setContentView(buildUi())

        statusText.text = "listening + discovering as $localName..."
        transport.startListening()
        startDiscovery()
    }

    private fun buildUi(): LinearLayout {
        val padding = (16 * resources.displayMetrics.density).toInt()

        statusText = TextView(this).apply {
            text = "starting..."
            textSize = 16f
            setPadding(0, 0, 0, padding)
        }

        val sendButtons = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
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
            val resumedConn = transport.connect(conn.peerId)
            logTransferResult("AUTO RESUME", transport.resume(resumedConn, payload, firstAttempt.bytesTransferred))
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
                val resumedConn = transport.connect(conn.peerId)
                logTransferResult("RESUME", transport.resume(resumedConn, payload, firstAttempt.bytesTransferred))
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
        Log.i("ResilientGeoLocalNet", "TRANSFER_RESULT $line")
        appendLog(line)
    }

    private fun appendLog(line: String) {
        Log.i("ResilientGeoLocalNet", "UI_LOG $line")
        runOnUiThread { logText.append("$line\n") }
    }

    override fun onDestroy() {
        discoverJob?.cancel()
        connection?.let { c -> lifecycleScope.launch { transport.close(c) } }
        transport.teardown()
        super.onDestroy()
    }
}
