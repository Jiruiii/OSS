package com.resilientgeo.mesh.transport

/**
 * Platform-neutral transport contract, mirroring docs/adr/ADR-001-transport-layer.md.
 *
 * Domain code (peer sync, chunk apply) should only ever talk to this
 * interface — never directly to BluetoothLeScanner, Nearby Connections, or
 * WifiP2pManager. That's what lets us swap the underlying transport after
 * the Stage 0 spike without touching sync logic.
 */
interface PeerTransport {

    /** Start advertising + scanning. Emits a PeerAdvertisement each time a peer is (re)seen. */
    fun discover(): kotlinx.coroutines.flow.Flow<PeerAdvertisement>

    /**
     * Every fully-received message from any peer, as (peerId, payload bytes).
     * A hot flow safe for a single long-lived collector — unlike [discover],
     * collecting it does not itself start or restart any radio operation.
     */
    val receivedMessages: kotlinx.coroutines.flow.SharedFlow<Pair<String, ByteArray>>

    /** Open a connection to a previously discovered peer. */
    suspend fun connect(peerId: String): Connection

    /** Send a request/response payload over an open connection, starting at byte 0. */
    suspend fun send(connection: Connection, payload: ByteArray): TransferResult

    /** Resume a previously interrupted send starting at [offsetBytes]. */
    suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult

    /** Close and release a connection. */
    suspend fun close(connection: Connection)
}

data class PeerAdvertisement(
    val peerId: String,
    val rssi: Int?,
    val discoveredAtMillis: Long,
)

data class Connection(
    val peerId: String,
    val connectionId: String,
)

sealed class TransferResult {
    data class Success(val bytesTransferred: Long, val durationMillis: Long) : TransferResult()
    data class Interrupted(val bytesTransferred: Long, val reason: String) : TransferResult()
    data class Failed(val reason: String) : TransferResult()
}
