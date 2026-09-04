package com.resilientgeo.mesh.transport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.NetworkInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
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
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

/**
 * ADR-001's fallback bulk-transfer candidate, used in place of
 * [NearbyConnectionsTransport] after that candidate returned a real,
 * reproducible `ApiException: 8: INTERNAL_ERROR` from Google Play Services'
 * own on-device Nearby module on both Stage 0 test devices (see ADR-001's
 * "实测记录" section) — not something fixable from this app's code.
 *
 * Wraps the platform's `WifiP2pManager` (no Play Services dependency at
 * all) for group formation/discovery, then moves bytes over a plain TCP
 * socket to the group owner once the P2P link is up — this app owns that
 * wire protocol completely, unlike Nearby Connections' opaque Payload API.
 *
 * Wire protocol per message (both directions use the same framing):
 *   [1 byte type: 0x01=DATA, 0x02=ACK] [if DATA: 8-byte big-endian length, then that many payload bytes]
 * A single background "receive loop" per connection owns all reads from the
 * socket's InputStream (Kotlin/Java sockets support concurrent read/write
 * from independent threads, but two independent *readers* on the same
 * InputStream is a real race — whichever thread's read() call happens to
 * consume the ACK header could easily be the one blocked waiting for a DATA
 * header instead, corrupting the frame stream). [send]/[resume] therefore
 * never read the socket directly — they hand off to the receive loop via
 * [pendingAcks] and only await a CompletableDeferred.
 *
 * Resume model: unlike Nearby Connections, this transport controls the wire
 * format end to end, so [resume] is a *real* mid-transfer continuation, not
 * just "send the tail as a new message" — the receive loop keeps re-opening
 * the socket (GO: accept() again on the same still-listening ServerSocket;
 * client: redial the group owner) whenever it dies, so the next DATA frame
 * (starting at the caller-supplied offset) just lands on a fresh socket.
 */
class WifiDirectTransport(private val context: Context) : PeerTransport {

    companion object {
        private const val TAG = "ResilientGeoWifiDirect"
        private const val PORT = 8988
        private const val SOCKET_CONNECT_RETRY_DELAY_MS = 300L
        private const val SOCKET_CONNECT_MAX_ATTEMPTS = 15
        private const val ACK_TIMEOUT_MS = 30_000L
        private const val CHUNK_SIZE = 64 * 1024

        private const val TYPE_DATA: Int = 0x01
        private const val TYPE_ACK: Int = 0x02

        // A GO can have >1 client in general, but Stage 0's spike only deals
        // with two devices, so a fixed id is fine — [acceptAsGroupOwner]
        // doesn't get a peerId to key off the way connect(peerId) does.
        private const val GROUP_OWNER_CONNECTION_ID = "group-owner-link"
    }

    private val manager = context.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager

    // Named p2pChannel, not channel: callbackFlow's ProducerScope receiver
    // (used in discover() below) has its own `channel: SendChannel<E>`
    // member, which would silently shadow a property named `channel` here
    // and resolve every WifiP2pManager call inside that block to the wrong
    // type (caught by the compiler as a type mismatch, not silently wrong,
    // but confusing enough to name around).
    private val p2pChannel = manager.initialize(context, Looper.getMainLooper(), null)
    private val transportScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private data class SocketConnection(
        val socket: Socket,
        val input: DataInputStream,
        val output: DataOutputStream,
    )

    private data class PeerLink(
        val isGroupOwner: Boolean,
        val groupOwnerAddress: InetAddress?,
        val serverSocket: ServerSocket?,
    )

    private val links = ConcurrentHashMap<String, PeerLink>()
    private val sockets = ConcurrentHashMap<String, SocketConnection>()
    private val outputLocks = ConcurrentHashMap<String, Mutex>()
    private val receiveLoops = ConcurrentHashMap<String, Job>()
    private val pendingAcks = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    /** Set by a test harness right before calling send()/resume(), so the receive loop can force-close the live socket mid-write to simulate a dropped connection. Not part of PeerTransport. */
    @Volatile
    var interruptRequested = false

    private var onPeerFound: ((PeerAdvertisement) -> Unit)? = null
    private var pendingConnectionInfo: CompletableDeferred<WifiP2pInfo>? = null
    private var receiverRegistered = false

    @Suppress("DEPRECATION") // WifiP2pManager.EXTRA_NETWORK_INFO still uses NetworkInfo; no replacement for P2P group state.
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
                    manager.requestPeers(p2pChannel) { peerList ->
                        peerList.deviceList.forEach { device ->
                            onPeerFound?.invoke(
                                PeerAdvertisement(
                                    peerId = device.deviceAddress,
                                    rssi = null,
                                    discoveredAtMillis = System.currentTimeMillis(),
                                ),
                            )
                        }
                    }
                }
                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                    val networkInfo = intent.getParcelableExtra<NetworkInfo>(WifiP2pManager.EXTRA_NETWORK_INFO)
                    if (networkInfo?.isConnected == true) {
                        manager.requestConnectionInfo(p2pChannel) { info ->
                            pendingConnectionInfo?.complete(info)
                        }
                    }
                }
            }
        }
    }

    private fun ensureReceiverRegistered() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
    }

    override fun discover(): Flow<PeerAdvertisement> = callbackFlow {
        ensureReceiverRegistered()
        onPeerFound = { advertisement -> trySend(advertisement) }

        manager.discoverPeers(
            p2pChannel,
            object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    Log.i(TAG, "discoverPeers started ok")
                }

                override fun onFailure(reasonCode: Int) {
                    Log.e(TAG, "discoverPeers failed, reason=$reasonCode")
                }
            },
        )

        awaitClose {
            onPeerFound = null
            manager.stopPeerDiscovery(p2pChannel, null)
        }
    }

    /**
     * Diagnostic only, not part of PeerTransport: asks the system for
     * whatever WifiP2pInfo it currently holds, without first calling
     * discoverPeers()/connect(). Used to check whether this app can read a
     * P2P group that was formed some other way (e.g. the system's own
     * Wi-Fi Direct settings screen) — isolates "our discoverPeers()/connect()
     * path is broken" from "this app can't talk to WifiP2pService at all."
     */
    suspend fun queryCurrentConnectionInfo(): WifiP2pInfo {
        ensureReceiverRegistered()
        val deferred = CompletableDeferred<WifiP2pInfo>()
        manager.requestConnectionInfo(p2pChannel) { info -> deferred.complete(info) }
        return deferred.await()
    }

    /**
     * For the group-owner side of an already-formed group: a GO does not see
     * its own already-associated client through discoverPeers()/requestPeers()
     * (confirmed empirically — the client's discover() found the GO and
     * connected fine, but the GO's own discover() never fired "peer found"
     * for that same client). So the GO can't reach this transport's normal
     * discover() -> connect(peerId) path at all once a group exists. This
     * skips straight to opening the listening socket using the group role
     * this device already knows about via [queryCurrentConnectionInfo].
     * Suspends (blocking on Dispatchers.IO) until a client connects.
     */
    suspend fun acceptAsGroupOwner(): Connection {
        val info = queryCurrentConnectionInfo()
        check(info.groupFormed && info.isGroupOwner) {
            "acceptAsGroupOwner() called but this device isn't currently a group owner: $info"
        }

        val connectionId = GROUP_OWNER_CONNECTION_ID
        val link = withContext(Dispatchers.IO) {
            Log.i(TAG, "acting as group owner, listening on port $PORT bound to ${info.groupOwnerAddress}")
            PeerLink(isGroupOwner = true, groupOwnerAddress = null, serverSocket = bindGroupOwnerServerSocket(info))
        }
        links[connectionId] = link
        sockets[connectionId] = withContext(Dispatchers.IO) { openOrAcceptSocket(link) }
        startReceiveLoop(connectionId)

        return Connection(peerId = GROUP_OWNER_CONNECTION_ID, connectionId = connectionId)
    }

    override suspend fun connect(peerId: String): Connection {
        ensureReceiverRegistered()

        val deferredInfo = CompletableDeferred<WifiP2pInfo>()
        pendingConnectionInfo = deferredInfo

        val deferredConnect = CompletableDeferred<Unit>()
        val config = WifiP2pConfig().apply { deviceAddress = peerId }
        manager.connect(
            p2pChannel,
            config,
            object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    deferredConnect.complete(Unit)
                }

                override fun onFailure(reasonCode: Int) {
                    deferredConnect.completeExceptionally(IllegalStateException("connect() failed, reason=$reasonCode"))
                }
            },
        )
        deferredConnect.await()

        // WIFI_P2P_CONNECTION_CHANGED_ACTION only fires on an actual state
        // change. If a group with this peer already exists (e.g. formed via
        // the system's own Wi-Fi Direct settings screen before this app ran),
        // manager.connect() succeeds but nothing changes, so the broadcast
        // never arrives and deferredInfo.await() would hang forever. Race it
        // against a direct requestConnectionInfo() poll instead of trusting
        // the broadcast alone.
        val info = withTimeoutOrNull(3_000) { deferredInfo.await() }
            ?: queryCurrentConnectionInfo()
        if (!info.groupFormed) {
            throw IllegalStateException("wifi p2p group not formed")
        }

        val connectionId = peerId
        val link = withContext(Dispatchers.IO) {
            if (info.isGroupOwner) {
                Log.i(TAG, "acting as group owner, listening on port $PORT bound to ${info.groupOwnerAddress}")
                PeerLink(isGroupOwner = true, groupOwnerAddress = null, serverSocket = bindGroupOwnerServerSocket(info))
            } else {
                Log.i(TAG, "acting as client, group owner at ${info.groupOwnerAddress}")
                PeerLink(isGroupOwner = false, groupOwnerAddress = info.groupOwnerAddress, serverSocket = null)
            }
        }
        links[connectionId] = link
        sockets[connectionId] = withContext(Dispatchers.IO) { openOrAcceptSocket(link) }
        startReceiveLoop(connectionId)

        return Connection(peerId = peerId, connectionId = connectionId)
    }

    /**
     * `ServerSocket(PORT)` alone binds a dual-stack socket to the IPv6
     * wildcard (`[::]:PORT`, confirmed via `netstat` on a real device) —
     * clients dialing the group owner's actual IPv4 address on the P2P
     * interface (e.g. `192.168.49.1`) got connection timeouts against that
     * socket even though ICMP to the same address worked fine, most likely
     * because Android's per-interface firewalling for the P2P link is keyed
     * to the concrete IPv4 address, not the IPv6-mapped path a wildcard bind
     * takes. Binding explicitly to [WifiP2pInfo.groupOwnerAddress] (which is
     * populated with this device's own P2P IPv4 address even when this
     * device *is* the group owner) fixed it.
     */
    private fun bindGroupOwnerServerSocket(info: WifiP2pInfo): ServerSocket {
        val bindAddress = info.groupOwnerAddress
        return if (bindAddress != null) {
            ServerSocket(PORT, 50, bindAddress)
        } else {
            Log.e(TAG, "WifiP2pInfo.groupOwnerAddress was null; falling back to a wildcard bind, which may not be reachable")
            ServerSocket(PORT)
        }
    }

    private fun openOrAcceptSocket(link: PeerLink): SocketConnection {
        val raw = if (link.isGroupOwner) {
            checkNotNull(link.serverSocket).accept()
        } else {
            var connected: Socket? = null
            var lastError: IOException? = null
            for (attempt in 1..SOCKET_CONNECT_MAX_ATTEMPTS) {
                try {
                    val candidate = Socket()
                    candidate.connect(InetSocketAddress(link.groupOwnerAddress, PORT), 3000)
                    connected = candidate
                    break
                } catch (e: IOException) {
                    lastError = e
                    Thread.sleep(SOCKET_CONNECT_RETRY_DELAY_MS)
                }
            }
            connected ?: throw (lastError ?: IOException("could not connect to group owner"))
        }
        return SocketConnection(raw, DataInputStream(raw.getInputStream()), DataOutputStream(raw.getOutputStream()))
    }

    /** The sole reader of a connection's socket InputStream: services inbound DATA frames (ack'ing them) and completes [pendingAcks] on inbound ACK frames, re-opening the socket whenever it dies. */
    private fun startReceiveLoop(connectionId: String) {
        receiveLoops[connectionId]?.cancel()
        receiveLoops[connectionId] = transportScope.launch {
            while (isActive) {
                val socketConnection = sockets[connectionId]
                if (socketConnection == null) {
                    val link = links[connectionId] ?: break
                    try {
                        sockets[connectionId] = openOrAcceptSocket(link)
                    } catch (e: IOException) {
                        Log.e(TAG, "receive loop: failed to reopen socket for $connectionId", e)
                    }
                    continue
                }

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
                            writeFrame(connectionId, socketConnection) { out -> out.writeByte(TYPE_ACK) }
                        }
                        TYPE_ACK -> {
                            pendingAcks.remove(connectionId)?.complete(Unit)
                        }
                        else -> Log.e(TAG, "receive loop: unknown frame type=$frameType on $connectionId")
                    }
                } catch (e: IOException) {
                    Log.i(TAG, "receive loop: socket broke for $connectionId (${e.message}), will reopen")
                    sockets.remove(connectionId)
                    try {
                        socketConnection.socket.close()
                    } catch (_: IOException) {
                    }
                }
            }
        }
    }

    private suspend fun writeFrame(connectionId: String, socketConnection: SocketConnection, body: (DataOutputStream) -> Unit) {
        val lock = outputLocks.getOrPut(connectionId) { Mutex() }
        lock.withLock {
            body(socketConnection.output)
            socketConnection.output.flush()
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
        val socketConnection = sockets[connectionId] ?: run {
            val link = links[connectionId] ?: return TransferResult.Failed("no known link for $connectionId")
            try {
                withContext(Dispatchers.IO) { openOrAcceptSocket(link) }.also { sockets[connectionId] = it }
            } catch (e: IOException) {
                return TransferResult.Failed("could not (re)open socket: ${e.message}")
            }
        }

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
        val connectionId = connection.connectionId
        receiveLoops.remove(connectionId)?.cancel()
        sockets.remove(connectionId)?.let {
            try {
                it.socket.close()
            } catch (_: IOException) {
            }
        }
        links.remove(connectionId)?.serverSocket?.let {
            try {
                it.close()
            } catch (_: IOException) {
            }
        }
        pendingAcks.remove(connectionId)?.cancel()
        manager.removeGroup(p2pChannel, null)
    }

    /** Releases the broadcast receiver and background coroutines. Not part of PeerTransport — call from the owning Activity's onDestroy(). */
    fun teardown() {
        if (receiverRegistered) {
            context.unregisterReceiver(receiver)
            receiverRegistered = false
        }
        transportScope.cancel()
    }
}
