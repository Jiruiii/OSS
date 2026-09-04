package com.resilientgeo.mesh.transport

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

/**
 * NOTE: superseded by BleGattTransport, which is what ADR-001 actually
 * accepted (2026-09-05) — see that ADR's decision record. This class
 * compiles but was never exercised end-to-end on real devices: while
 * setting up a shared Wi-Fi network to test it, BLE GATT was tried instead
 * and worked first, so this path was abandoned mid-validation. Kept as a
 * documented, code-reviewed fallback in case BLE's throughput ever becomes
 * insufficient, but treat it as unvalidated until it's actually run device-
 * to-device.
 *
 * ADR-001's second fallback (originally): a plain TCP transport over
 * whatever regular Wi-Fi network both devices already share (one phone's
 * personal hotspot,
 * or a common venue/router network) — NOT the WifiP2pManager P2P interface.
 *
 * Why this exists: [WifiDirectTransport]'s raw P2P sockets got a confirmed,
 * reproducible TCP connect timeout to a correctly-bound, actually-listening
 * ServerSocket on the p2p-wlan0 interface, while ICMP to the same address
 * worked fine. The leading theory: since Android 10, an app's plain
 * Socket/ServerSocket doesn't automatically route over a WifiP2pManager
 * connection when the device also has another network active (mobile data,
 * in this case) marked as the system default — Android requires binding the
 * socket to the specific `android.net.Network` obtained via
 * ConnectivityManager for P2P traffic to route correctly, which this app's
 * WifiDirectTransport wasn't doing. A regular Wi-Fi connection (hotspot or
 * shared AP) doesn't have that ambiguity — it typically *is* the default
 * network, so plain sockets just work, which is exactly why this class
 * exists as a fast, low-risk fallback rather than adding Network-binding to
 * WifiDirectTransport under time pressure.
 *
 * Peer discovery uses NsdManager (mDNS/DNS-SD), not a hardcoded hotspot
 * gateway IP — Android's hotspot gateway address isn't guaranteed to be the
 * classic 192.168.43.1 on every device/OS version, so guessing it would just
 * trade one fragile assumption for another.
 *
 * The wire protocol (chunked DATA/ACK framing, mid-transfer interrupt +
 * real byte-offset resume) is identical to WifiDirectTransport's — only how
 * the two sides find each other's IP:port changes.
 */
class LocalNetworkTransport(
    private val context: Context,
    private val localServiceName: String,
) : PeerTransport {

    companion object {
        private const val TAG = "ResilientGeoLocalNet"
        private const val SERVICE_TYPE = "_resilientgeo._tcp."
        private const val PORT = 8988
        private const val CHUNK_SIZE = 64 * 1024
        private const val ACK_TIMEOUT_MS = 30_000L
        private const val TYPE_DATA: Int = 0x01
        private const val TYPE_ACK: Int = 0x02
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val transportScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Android drops multicast packets on Wi-Fi by default to save power,
    // which silently breaks mDNS/NSD discovery (announcements go out fine,
    // but this device won't *receive* the other side's ones) unless a
    // WifiManager.MulticastLock is held for as long as discovery matters.
    private val multicastLock: WifiManager.MulticastLock by lazy {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiManager.createMulticastLock("resilientgeo-nsd").apply { setReferenceCounted(true) }
    }

    private data class SocketConnection(
        val socket: Socket,
        val input: DataInputStream,
        val output: DataOutputStream,
    )

    private val sockets = ConcurrentHashMap<String, SocketConnection>()
    private val outputLocks = ConcurrentHashMap<String, Mutex>()
    private val receiveLoops = ConcurrentHashMap<String, Job>()
    private val pendingAcks = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    /** Set by a test harness right before send()/resume(), so the write loop can bail out mid-chunk to simulate a dropped connection. Not part of PeerTransport. */
    @Volatile
    var interruptRequested = false

    private var serverSocket: ServerSocket? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var acceptLoopJob: Job? = null
    private var onPeerFound: ((PeerAdvertisement) -> Unit)? = null

    /**
     * Starts listening for inbound connections and advertises this device
     * via NSD so the other side's [discover] can find it. Call once before
     * [discover]/[connect] — both sides of a demo call this, since either
     * device might be the one that ends up initiating [connect].
     */
    fun startListening() {
        if (serverSocket != null) return
        multicastLock.acquire()
        val raw = ServerSocket(PORT)
        serverSocket = raw
        Log.i(TAG, "listening on port ${raw.localPort}")

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = localServiceName
            serviceType = SERVICE_TYPE
            port = raw.localPort
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD service registered: ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "NSD registration failed, errorCode=$errorCode")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        }
        registrationListener = listener
        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)

        acceptLoopJob = transportScope.launch {
            while (isActive) {
                try {
                    val accepted = raw.accept()
                    val remote = accepted.inetAddress.hostAddress ?: "unknown"
                    val connectionId = "$remote:${accepted.port}"
                    Log.i(TAG, "accepted inbound connection from $connectionId")
                    sockets[connectionId] = SocketConnection(
                        accepted,
                        DataInputStream(accepted.getInputStream()),
                        DataOutputStream(accepted.getOutputStream()),
                    )
                    startReceiveLoop(connectionId)
                } catch (e: IOException) {
                    if (isActive) Log.e(TAG, "accept() failed", e)
                }
            }
        }
    }

    override fun discover(): Flow<PeerAdvertisement> = callbackFlow {
        onPeerFound = { advertisement -> trySend(advertisement) }

        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType.trimEnd('.') != SERVICE_TYPE.trimEnd('.')) return
                if (serviceInfo.serviceName == localServiceName) return
                Log.i(TAG, "onServiceFound: ${serviceInfo.serviceName}")
                nsdManager.resolveService(
                    serviceInfo,
                    object : NsdManager.ResolveListener {
                        override fun onServiceResolved(resolved: NsdServiceInfo) {
                            val host = resolved.host?.hostAddress ?: return
                            Log.i(TAG, "resolved ${resolved.serviceName} -> $host:${resolved.port}")
                            onPeerFound?.invoke(
                                PeerAdvertisement(
                                    peerId = "$host:${resolved.port}",
                                    rssi = null,
                                    discoveredAtMillis = System.currentTimeMillis(),
                                ),
                            )
                        }

                        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                            Log.e(TAG, "resolve failed for ${info.serviceName}, errorCode=$errorCode")
                        }
                    },
                )
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "onServiceLost: ${serviceInfo.serviceName}")
            }

            override fun onDiscoveryStarted(serviceType: String) {
                Log.i(TAG, "NSD discovery started")
            }

            override fun onDiscoveryStopped(serviceType: String) {}

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "NSD discovery failed to start, errorCode=$errorCode")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)

        awaitClose {
            onPeerFound = null
            nsdManager.stopServiceDiscovery(discoveryListener)
        }
    }

    override suspend fun connect(peerId: String): Connection {
        // peerId is "host:port", as produced by discover() above.
        sockets[peerId]?.let { return Connection(peerId = peerId, connectionId = peerId) }

        val (host, portStr) = peerId.split(":", limit = 2)
        val port = portStr.toInt()
        val socketConnection = withContext(Dispatchers.IO) {
            val raw = Socket()
            raw.connect(InetSocketAddress(host, port), 5_000)
            SocketConnection(raw, DataInputStream(raw.getInputStream()), DataOutputStream(raw.getOutputStream()))
        }
        sockets[peerId] = socketConnection
        startReceiveLoop(peerId)
        return Connection(peerId = peerId, connectionId = peerId)
    }

    private fun startReceiveLoop(connectionId: String) {
        receiveLoops[connectionId]?.cancel()
        receiveLoops[connectionId] = transportScope.launch {
            val socketConnection = sockets[connectionId] ?: return@launch
            while (isActive) {
                try {
                    when (val frameType = socketConnection.input.readByte().toInt()) {
                        TYPE_DATA -> {
                            var remainingToRead = socketConnection.input.readLong()
                            val buffer = ByteArray(CHUNK_SIZE)
                            while (remainingToRead > 0) {
                                val toRead = minOf(buffer.size.toLong(), remainingToRead).toInt()
                                val read = socketConnection.input.read(buffer, 0, toRead)
                                if (read < 0) throw IOException("peer closed stream mid-payload")
                                remainingToRead -= read
                            }
                            val lock = outputLocks.getOrPut(connectionId) { Mutex() }
                            lock.withLock {
                                socketConnection.output.writeByte(TYPE_ACK)
                                socketConnection.output.flush()
                            }
                        }
                        TYPE_ACK -> {
                            pendingAcks.remove(connectionId)?.complete(Unit)
                        }
                        else -> Log.e(TAG, "unknown frame type=$frameType on $connectionId")
                    }
                } catch (e: IOException) {
                    Log.i(TAG, "receive loop: socket broke for $connectionId (${e.message})")
                    sockets.remove(connectionId)
                    try {
                        socketConnection.socket.close()
                    } catch (_: IOException) {
                    }
                    return@launch
                }
            }
        }
    }

    override suspend fun send(connection: Connection, payload: ByteArray): TransferResult =
        transfer(connection, payload, offsetBytes = 0L)

    override suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult =
        transfer(connection, payload, offsetBytes)

    private suspend fun transfer(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult {
        val remaining = if (offsetBytes in 1 until payload.size.toLong()) {
            payload.copyOfRange(offsetBytes.toInt(), payload.size)
        } else {
            payload
        }

        val connectionId = connection.connectionId
        val socketConnection = sockets[connectionId]
            ?: return TransferResult.Failed("no open socket for $connectionId; call connect() again")

        val ackDeferred = CompletableDeferred<Unit>()
        pendingAcks[connectionId] = ackDeferred

        val startedAt = System.currentTimeMillis()
        var sent = 0

        val writeResult = withContext(Dispatchers.IO) {
            try {
                val lock = outputLocks.getOrPut(connectionId) { Mutex() }
                lock.withLock {
                    socketConnection.output.writeByte(TYPE_DATA)
                    socketConnection.output.writeLong(remaining.size.toLong())
                    var offset = 0
                    while (offset < remaining.size) {
                        if (interruptRequested) {
                            interruptRequested = false
                            sockets.remove(connectionId)
                            try {
                                socketConnection.socket.close()
                            } catch (_: IOException) {
                            }
                            return@withContext TransferResult.Interrupted(bytesTransferred = sent.toLong(), reason = "simulated interrupt")
                        }
                        val len = minOf(CHUNK_SIZE, remaining.size - offset)
                        socketConnection.output.write(remaining, offset, len)
                        offset += len
                        sent += len
                    }
                    socketConnection.output.flush()
                }
                null
            } catch (e: IOException) {
                sockets.remove(connectionId)
                TransferResult.Interrupted(bytesTransferred = sent.toLong(), reason = e.message ?: "io error")
            }
        }
        if (writeResult != null) {
            pendingAcks.remove(connectionId)
            return writeResult
        }

        val acked = withTimeoutOrNull(ACK_TIMEOUT_MS) { ackDeferred.await() }
        pendingAcks.remove(connectionId)
        return if (acked == null) {
            TransferResult.Failed("ack timeout after sending $sent bytes")
        } else {
            TransferResult.Success(bytesTransferred = sent.toLong(), durationMillis = System.currentTimeMillis() - startedAt)
        }
    }

    override suspend fun close(connection: Connection) {
        receiveLoops.remove(connection.connectionId)?.cancel()
        sockets.remove(connection.connectionId)?.let {
            try {
                it.socket.close()
            } catch (_: IOException) {
            }
        }
        pendingAcks.remove(connection.connectionId)?.cancel()
    }

    /** Releases NSD registration/discovery and background coroutines. Not part of PeerTransport — call from the owning Activity's onDestroy(). */
    fun teardown() {
        registrationListener?.let { nsdManager.unregisterService(it) }
        registrationListener = null
        acceptLoopJob?.cancel()
        try {
            serverSocket?.close()
        } catch (_: IOException) {
        }
        serverSocket = null
        if (multicastLock.isHeld) multicastLock.release()
        transportScope.cancel()
    }
}
