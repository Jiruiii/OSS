package com.resilientgeo.mesh.transport

import android.content.Context
import android.util.Log
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.io.ByteArrayInputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * ADR-001's bulk-transfer candidate: wraps Google Play Services' Nearby
 * Connections API (`com.google.android.gms.nearby.connection`) behind
 * [PeerTransport], so domain code never touches `ConnectionsClient` directly.
 *
 * As of the July 2026 "Upcoming Changes to the Nearby Connections API" post
 * (developer.android.com/blog/posts/upcoming-changes-to-the-nearby-connections-api),
 * this API is not being deprecated, but late-2026 it stops auto-enabling
 * Bluetooth/Wi-Fi radios for the caller. This class does not yet check radio
 * state before starting — that's a known gap, tracked as a follow-up once the
 * Stage 0 throughput/resume numbers are in (no point hardening a transport
 * ADR-001 hasn't accepted yet).
 *
 * Resume model: Nearby Connections has no native mid-payload byte-offset
 * resume — a `Payload` is one atomic unit from Nearby's point of view. This
 * class implements ADR-001's documented fallback instead: [resume] slices the
 * original array from `offsetBytes` and sends it as a *new* Payload. The
 * caller is expected to get `offsetBytes` from a prior [TransferResult]'s
 * `bytesTransferred` (e.g. after a cancelled/interrupted send) and to handle
 * appending received bytes at that offset on the receiving side — this
 * transport only moves bytes, it doesn't know about chunk/event semantics.
 */
class NearbyConnectionsTransport(
    context: Context,
    private val localName: String,
) : PeerTransport {

    companion object {
        private const val TAG = "ResilientGeoNearby"

        // Identifies "this is a ResilientGeo Mesh node" to Nearby Connections,
        // mirroring BleDiscovery.SERVICE_UUID's role for the BLE spike.
        const val SERVICE_ID = "com.resilientgeo.mesh"

        // P2P_POINT_TO_POINT: one connection at a time, higher bandwidth per
        // connection than P2P_CLUSTER/P2P_STAR. Fine for a two-device spike;
        // Stage 3's multi-peer Store-Carry-Forward will need to revisit this.
        private val STRATEGY = Strategy.P2P_POINT_TO_POINT
    }

    private val connectionsClient: ConnectionsClient = Nearby.getConnectionsClient(context)

    private val pendingConnections = ConcurrentHashMap<String, CompletableDeferred<Connection>>()
    private val pendingTransfers = ConcurrentHashMap<Long, CompletableDeferred<TransferResult>>()
    private val transferStartedAtMillis = ConcurrentHashMap<Long, Long>()

    /** Set by a test harness right after send()/resume() returns its payload id, so a spike UI can force-cancel an in-flight transfer to simulate a dropped connection. Not part of PeerTransport. */
    @Volatile
    var lastOutboundPayloadId: Long? = null
        private set

    private var onPeerFound: ((PeerAdvertisement) -> Unit)? = null

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
            Log.i(TAG, "onConnectionInitiated endpointId=$endpointId name=${connectionInfo.endpointName}")
            connectionsClient.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            Log.i(TAG, "onConnectionResult endpointId=$endpointId status=${result.status}")
            val deferred = pendingConnections.remove(endpointId) ?: return
            if (result.status.isSuccess) {
                deferred.complete(Connection(peerId = endpointId, connectionId = endpointId))
            } else {
                deferred.completeExceptionally(IllegalStateException("connect failed: ${result.status}"))
            }
        }

        override fun onDisconnected(endpointId: String) {
            Log.i(TAG, "onDisconnected endpointId=$endpointId")
            pendingConnections.remove(endpointId)?.completeExceptionally(IllegalStateException("disconnected"))
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            // Stage 0 spike only measures transfer completion/throughput; it
            // doesn't consume payload bytes into the event pipeline yet (that
            // wiring is Peer Sync's job once this transport is accepted).
            Log.i(TAG, "onPayloadReceived endpointId=$endpointId payloadId=${payload.id} type=${payload.type}")
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
            val deferred = pendingTransfers[update.payloadId] ?: return
            when (update.status) {
                PayloadTransferUpdate.Status.SUCCESS -> completeTransfer(update) {
                    TransferResult.Success(
                        bytesTransferred = update.totalBytes,
                        durationMillis = it,
                    )
                }
                PayloadTransferUpdate.Status.FAILURE -> completeTransfer(update) {
                    TransferResult.Failed("nearby payload transfer failed, endpointId=$endpointId")
                }
                PayloadTransferUpdate.Status.CANCELED -> completeTransfer(update) {
                    TransferResult.Interrupted(
                        bytesTransferred = update.bytesTransferred,
                        reason = "canceled",
                    )
                }
                PayloadTransferUpdate.Status.IN_PROGRESS -> {
                    // No-op: callers only await the terminal states above.
                    // Left as a hook for a future progress bar / live
                    // throughput readout if the spike UI wants one.
                }
            }
        }

        private fun completeTransfer(update: PayloadTransferUpdate, resultOf: (durationMillis: Long) -> TransferResult) {
            val deferred = pendingTransfers.remove(update.payloadId) ?: return
            val startedAt = transferStartedAtMillis.remove(update.payloadId) ?: System.currentTimeMillis()
            deferred.complete(resultOf(System.currentTimeMillis() - startedAt))
        }
    }

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            if (info.serviceId != SERVICE_ID) return
            Log.i(TAG, "onEndpointFound endpointId=$endpointId name=${info.endpointName}")
            onPeerFound?.invoke(
                PeerAdvertisement(
                    peerId = endpointId,
                    rssi = null,
                    discoveredAtMillis = System.currentTimeMillis(),
                ),
            )
        }

        override fun onEndpointLost(endpointId: String) {
            Log.i(TAG, "onEndpointLost endpointId=$endpointId")
        }
    }

    override fun discover(): Flow<PeerAdvertisement> = callbackFlow {
        onPeerFound = { advertisement -> trySend(advertisement) }

        connectionsClient
            .startAdvertising(
                localName,
                SERVICE_ID,
                connectionLifecycleCallback,
                AdvertisingOptions.Builder().setStrategy(STRATEGY).build(),
            )
            .addOnSuccessListener { Log.i(TAG, "advertising started ok") }
            .addOnFailureListener { e -> Log.e(TAG, "startAdvertising failed", e) }

        connectionsClient
            .startDiscovery(
                SERVICE_ID,
                endpointDiscoveryCallback,
                DiscoveryOptions.Builder().setStrategy(STRATEGY).build(),
            )
            .addOnSuccessListener { Log.i(TAG, "discovery started ok") }
            .addOnFailureListener { e -> Log.e(TAG, "startDiscovery failed", e) }

        awaitClose {
            onPeerFound = null
            connectionsClient.stopAdvertising()
            connectionsClient.stopDiscovery()
        }
    }

    override suspend fun connect(peerId: String): Connection {
        val deferred = CompletableDeferred<Connection>()
        pendingConnections[peerId] = deferred
        try {
            connectionsClient.requestConnection(localName, peerId, connectionLifecycleCallback).await()
        } catch (e: Exception) {
            pendingConnections.remove(peerId)
            throw e
        }
        return deferred.await()
    }

    override suspend fun send(connection: Connection, payload: ByteArray): TransferResult =
        transfer(connection, payload, offsetBytes = 0L)

    override suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult =
        transfer(connection, payload, offsetBytes)

    /** Lets a test harness cancel the most recently started outbound transfer, to simulate a dropped connection mid-transfer for the resume test. Not part of PeerTransport. */
    fun cancelLastOutboundTransfer() {
        lastOutboundPayloadId?.let { connectionsClient.cancelPayload(it) }
    }

    private suspend fun transfer(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult {
        val remaining = if (offsetBytes in 1 until payload.size.toLong()) {
            payload.copyOfRange(offsetBytes.toInt(), payload.size)
        } else {
            payload
        }

        val nearbyPayload = Payload.fromStream(ByteArrayInputStream(remaining))
        lastOutboundPayloadId = nearbyPayload.id

        val deferred = CompletableDeferred<TransferResult>()
        pendingTransfers[nearbyPayload.id] = deferred
        transferStartedAtMillis[nearbyPayload.id] = System.currentTimeMillis()

        connectionsClient.sendPayload(connection.peerId, nearbyPayload).await()
        return deferred.await()
    }

    override suspend fun close(connection: Connection) {
        connectionsClient.disconnectFromEndpoint(connection.peerId)
    }
}
