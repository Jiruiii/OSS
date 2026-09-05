package com.resilientgeo.mesh.transport

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * ADR-001's third bulk-transfer candidate — plain BLE GATT, chosen after
 * both Nearby Connections (Google Play services INTERNAL_ERROR) and
 * WifiDirectTransport (raw P2P sockets: confirmed TCP connect timeout to a
 * correctly bound, listening ServerSocket despite working ICMP — looks like
 * an Android per-app default-network routing issue, not fixable quickly)
 * hit real platform-level blockers on the Stage 0 test devices, independent
 * of application code.
 *
 * Unlike those two, this reuses [BleDiscovery]'s already-proven-reliable
 * advertise/scan pair (see C_BLEbroadcast.md) and layers real data transfer
 * on top via a custom GATT service: one WRITE characteristic (central ->
 * peripheral chunk stream) and one NOTIFY characteristic (peripheral -> ack).
 * Every device runs BOTH roles simultaneously — its own GATT server
 * (peripheral, receives inbound data from whoever connects to it) and, once
 * [discover] finds a peer's advertisement, a GATT client connection to that
 * peer (central, so it can send). Real event/chunk payloads for this
 * project are KB-scale, not the 1/10MB ADR-001 originally stress-tested
 * Nearby/Wi-Fi Direct against — BLE's lower throughput is not expected to
 * be a problem for the actual application, only for that stress-test number.
 *
 * Wire framing: first WRITE of a message = 4-byte big-endian length header
 * + as much payload as fits in one negotiated-MTU write; later WRITEs are
 * pure continuation bytes until the declared length is reached, then the
 * peripheral NOTIFYs a 1-byte ack back. GATT writes must be issued one at a
 * time — the stack does not support overlapping writeCharacteristic() calls
 * — so throughput is bounded by round-trip latency per chunk, not just MTU.
 */
class BleGattTransport(
    private val context: Context,
    private val adapter: BluetoothAdapter,
) : PeerTransport {

    companion object {
        private const val TAG = "ResilientGeoBleGatt"
        val SERVICE_UUID: UUID = BleDiscovery.SERVICE_UUID
        val DATA_CHARACTERISTIC_UUID: UUID = UUID.fromString("8f6a1c01-0000-4000-8000-00805f9b34fb")
        val ACK_CHARACTERISTIC_UUID: UUID = UUID.fromString("8f6a1c02-0000-4000-8000-00805f9b34fb")
        private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val DESIRED_MTU = 247
        private const val HEADER_BYTES = 4
        private const val WRITE_TIMEOUT_MS = 10_000L
        private const val ACK_TIMEOUT_MS = 30_000L
    }

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val advertiser get() = adapter.bluetoothLeAdvertiser
    private val scanner get() = adapter.bluetoothLeScanner

    private data class CentralLink(
        val gatt: BluetoothGatt,
        val dataCharacteristic: BluetoothGattCharacteristic,
        val ackCharacteristic: BluetoothGattCharacteristic,
        val mtuPayloadSize: Int,
    )

    private val centralLinks = ConcurrentHashMap<String, CentralLink>()

    // Single-flight assumption (one in-progress send at a time), matching
    // this Stage 0 spike's usage — good enough here, not a general-purpose
    // multiplexed transport.
    @Volatile private var pendingWriteAck: CompletableDeferred<Boolean>? = null
    @Volatile private var pendingAckNotify: CompletableDeferred<Unit>? = null

    @Volatile
    var interruptRequested = false

    // --- GATT server (peripheral): receives inbound data regardless of
    // which peer connects to us as central. ---

    private var gattServer: BluetoothGattServer? = null
    private val incomingMessages = ConcurrentHashMap<String, IncomingMessage>()
    private val subscribedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    private class IncomingMessage {
        var expectedLength: Int = -1
        val buffer = ByteArrayOutputStream()
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            Log.i(TAG, "server: onConnectionStateChange device=${device.address} status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                incomingMessages.remove(device.address)
                subscribedDevices.remove(device.address)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
            if (characteristic.uuid == DATA_CHARACTERISTIC_UUID) {
                handleIncomingChunk(device, value)
            }
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
            if (descriptor.uuid == CCCD_UUID) {
                if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    subscribedDevices[device.address] = device
                    Log.i(TAG, "server: ${device.address} subscribed to ACK notifications")
                } else {
                    subscribedDevices.remove(device.address)
                }
            }
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }
    }

    private fun handleIncomingChunk(device: BluetoothDevice, value: ByteArray) {
        val message = incomingMessages.getOrPut(device.address) { IncomingMessage() }
        val payloadChunk = if (message.expectedLength < 0) {
            val header = ByteBuffer.wrap(value, 0, HEADER_BYTES).order(ByteOrder.BIG_ENDIAN)
            message.expectedLength = header.int
            value.copyOfRange(HEADER_BYTES, value.size)
        } else {
            value
        }
        message.buffer.write(payloadChunk)

        if (message.buffer.size() >= message.expectedLength) {
            Log.i(TAG, "server: received full message (${message.buffer.size()} bytes) from ${device.address}")
            incomingMessages.remove(device.address)
            sendAck(device)
        }
    }

    private fun sendAck(device: BluetoothDevice) {
        val server = gattServer ?: return
        val ackChar = server.getService(SERVICE_UUID)?.getCharacteristic(ACK_CHARACTERISTIC_UUID) ?: return
        if (!subscribedDevices.containsKey(device.address)) {
            Log.e(TAG, "server: ${device.address} never subscribed to ACK notifications; can't ack")
            return
        }
        val ackValue = byteArrayOf(1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(device, ackChar, false, ackValue)
        } else {
            @Suppress("DEPRECATION")
            run {
                ackChar.value = ackValue
                server.notifyCharacteristicChanged(device, ackChar, false)
            }
        }
    }

    private fun ensureGattServerStarted() {
        if (gattServer != null) return
        val server = bluetoothManager.openGattServer(context, gattServerCallback)
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val dataChar = BluetoothGattCharacteristic(
            DATA_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        val ackChar = BluetoothGattCharacteristic(
            ACK_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
        ackChar.addDescriptor(
            BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE),
        )
        service.addCharacteristic(dataChar)
        service.addCharacteristic(ackChar)
        server.addService(service)
        gattServer = server
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "advertise started ok")
        }

        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "advertise failed to start, errorCode=$errorCode")
        }
    }

    fun startAdvertising() {
        ensureGattServerStarted()
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .setIncludeDeviceName(false)
            .build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
            ?: Log.e(TAG, "no BLE advertiser available on this device")
    }

    fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
    }

    // --- discovery (central-side scanning, identical filtering to BleDiscovery) ---

    private var onPeerFound: ((PeerAdvertisement) -> Unit)? = null
    private var scanCallback: ScanCallback? = null

    override fun discover(): Flow<PeerAdvertisement> = callbackFlow {
        onPeerFound = { advertisement -> trySend(advertisement) }
        startAdvertising()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                onPeerFound?.invoke(
                    PeerAdvertisement(
                        peerId = result.device.address,
                        rssi = result.rssi,
                        discoveredAtMillis = System.currentTimeMillis(),
                    ),
                )
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "scan failed to start, errorCode=$errorCode")
            }
        }
        scanCallback = callback
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        scanner?.startScan(listOf(filter), settings, callback)
            ?: Log.e(TAG, "no BLE scanner available on this device")

        awaitClose {
            onPeerFound = null
            scanCallback?.let { scanner?.stopScan(it) }
            scanCallback = null
        }
    }

    // --- connect (central role: connectGatt to a discovered peer) ---

    override suspend fun connect(peerId: String): Connection {
        centralLinks[peerId]?.let { return Connection(peerId = peerId, connectionId = peerId) }

        val device = adapter.getRemoteDevice(peerId)
        val connected = CompletableDeferred<Boolean>()
        val servicesDiscovered = CompletableDeferred<Boolean>()
        val mtuDeferred = CompletableDeferred<Int>()
        val descriptorWriteDeferred = CompletableDeferred<Boolean>()

        val callback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                Log.i(TAG, "client: onConnectionStateChange peer=$peerId status=$status newState=$newState")
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> connected.complete(true)
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        connected.complete(false)
                        centralLinks.remove(peerId)
                    }
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                servicesDiscovered.complete(status == BluetoothGatt.GATT_SUCCESS)
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                mtuDeferred.complete(mtu)
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                descriptorWriteDeferred.complete(status == BluetoothGatt.GATT_SUCCESS)
            }

            override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                pendingWriteAck?.complete(status == BluetoothGatt.GATT_SUCCESS)
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                if (characteristic.uuid == ACK_CHARACTERISTIC_UUID) pendingAckNotify?.complete(Unit)
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == ACK_CHARACTERISTIC_UUID) pendingAckNotify?.complete(Unit)
            }
        }

        val gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)

        val connectedOk = withTimeoutOrNull(15_000) { connected.await() } ?: false
        if (!connectedOk) throw IllegalStateException("GATT connect failed/timed out for $peerId")

        gatt.discoverServices()
        val discoveredOk = withTimeoutOrNull(10_000) { servicesDiscovered.await() } ?: false
        if (!discoveredOk) throw IllegalStateException("service discovery failed for $peerId")

        val service = gatt.getService(SERVICE_UUID)
            ?: throw IllegalStateException("peer $peerId doesn't expose our GATT service")
        val dataChar = service.getCharacteristic(DATA_CHARACTERISTIC_UUID)
            ?: throw IllegalStateException("peer $peerId missing data characteristic")
        val ackChar = service.getCharacteristic(ACK_CHARACTERISTIC_UUID)
            ?: throw IllegalStateException("peer $peerId missing ack characteristic")

        gatt.setCharacteristicNotification(ackChar, true)
        ackChar.getDescriptor(CCCD_UUID)?.let { cccd ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            } else {
                @Suppress("DEPRECATION")
                run {
                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    gatt.writeDescriptor(cccd)
                }
            }
            withTimeoutOrNull(5_000) { descriptorWriteDeferred.await() }
        }

        gatt.requestMtu(DESIRED_MTU)
        val negotiatedMtu = withTimeoutOrNull(5_000) { mtuDeferred.await() } ?: 23

        centralLinks[peerId] = CentralLink(
            gatt = gatt,
            dataCharacteristic = dataChar,
            ackCharacteristic = ackChar,
            // BLE's ATT spec caps a single attribute value at 512 bytes
            // regardless of negotiated ATT_MTU (which can go up to 517) —
            // a negotiated MTU of 517 gives (517-3)=514 bytes of "room" that
            // writeCharacteristic() then rejects with "value should not be
            // longer than max length of an attribute value". Confirmed by
            // hitting that exact exception on a real device before adding
            // this cap.
            mtuPayloadSize = (negotiatedMtu - 3).coerceIn(20, 512),
        )
        Log.i(TAG, "connected to $peerId, mtuPayloadSize=${negotiatedMtu - 3}")

        return Connection(peerId = peerId, connectionId = peerId)
    }

    override suspend fun send(connection: Connection, payload: ByteArray): TransferResult =
        transfer(connection, payload, offsetBytes = 0L)

    override suspend fun resume(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult =
        transfer(connection, payload, offsetBytes)

    private suspend fun transfer(connection: Connection, payload: ByteArray, offsetBytes: Long): TransferResult {
        val link = centralLinks[connection.connectionId]
            ?: return TransferResult.Failed("no active GATT link for ${connection.connectionId}; call connect() again")

        val remaining = if (offsetBytes in 1 until payload.size.toLong()) {
            payload.copyOfRange(offsetBytes.toInt(), payload.size)
        } else {
            payload
        }

        val startedAt = System.currentTimeMillis()
        var sent = 0
        val chunkSize = link.mtuPayloadSize
        var offset = 0
        var first = true

        val ackDeferred = CompletableDeferred<Unit>()
        pendingAckNotify = ackDeferred

        while (offset < remaining.size) {
            if (interruptRequested) {
                interruptRequested = false
                pendingAckNotify = null
                return TransferResult.Interrupted(bytesTransferred = sent.toLong(), reason = "simulated interrupt")
            }

            val payloadRoom = if (first) chunkSize - HEADER_BYTES else chunkSize
            val len = minOf(payloadRoom, remaining.size - offset)
            val chunk = if (first) {
                val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.BIG_ENDIAN).putInt(remaining.size).array()
                header + remaining.copyOfRange(offset, offset + len)
            } else {
                remaining.copyOfRange(offset, offset + len)
            }
            first = false

            val writeDeferred = CompletableDeferred<Boolean>()
            pendingWriteAck = writeDeferred
            if (!writeCharacteristicChunk(link, chunk)) {
                pendingAckNotify = null
                return TransferResult.Failed("writeCharacteristic() failed to queue at offset $offset")
            }
            val writeOk = withTimeoutOrNull(WRITE_TIMEOUT_MS) { writeDeferred.await() } ?: false
            if (!writeOk) {
                pendingAckNotify = null
                return TransferResult.Failed("GATT write failed/timed out at offset $offset")
            }

            offset += len
            sent += len
        }

        val acked = withTimeoutOrNull(ACK_TIMEOUT_MS) { ackDeferred.await() }
        pendingAckNotify = null
        return if (acked == null) {
            TransferResult.Failed("ack timeout after sending $sent bytes")
        } else {
            TransferResult.Success(bytesTransferred = sent.toLong(), durationMillis = System.currentTimeMillis() - startedAt)
        }
    }

    private fun writeCharacteristicChunk(link: CentralLink, chunk: ByteArray): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            link.gatt.writeCharacteristic(
                link.dataCharacteristic,
                chunk,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
            ) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                link.dataCharacteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                link.dataCharacteristic.value = chunk
                link.gatt.writeCharacteristic(link.dataCharacteristic)
            }
        }
    }

    override suspend fun close(connection: Connection) {
        centralLinks.remove(connection.connectionId)?.let {
            it.gatt.disconnect()
            it.gatt.close()
        }
    }

    /** Stops advertising/scanning/server and releases GATT resources. Not part of PeerTransport — call from the owning Activity's onDestroy(). */
    fun teardown() {
        stopAdvertising()
        scanCallback?.let { scanner?.stopScan(it) }
        scanCallback = null
        gattServer?.close()
        gattServer = null
        centralLinks.values.forEach {
            it.gatt.disconnect()
            it.gatt.close()
        }
        centralLinks.clear()
    }
}
