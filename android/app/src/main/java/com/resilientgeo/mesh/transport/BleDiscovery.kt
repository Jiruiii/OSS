package com.resilientgeo.mesh.transport

import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID

/**
 * Stage 0 spike scaffold: BLE-only discovery.
 *
 * This does NOT need a second physical device to sanity-check. Run it on
 * your one phone and watch Logcat (filter tag "ResilientGeoBle") — you are
 * only confirming that advertising/scanning start without error and that
 * runtime permissions are granted correctly. Actually seeing another peer's
 * advertisement requires a second real device nearby; that's the part to
 * borrow a phone for.
 */
class BleDiscovery(private val adapter: BluetoothAdapter) {

    companion object {
        private const val TAG = "ResilientGeoBle"
        // Placeholder UUID identifying "this is a ResilientGeo Mesh node".
        // Replace with a team-agreed constant before real testing so everyone's
        // devices recognize each other.
        val SERVICE_UUID: UUID = UUID.fromString("8f6a1c00-0000-4000-8000-00805f9b34fb")
    }

    private val advertiser get() = adapter.bluetoothLeAdvertiser
    private val scanner get() = adapter.bluetoothLeScanner

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "advertise started ok")
        }

        override fun onStartFailure(errorCode: Int) {
            // errorCode meanings: see AdvertiseCallback.ADVERTISE_FAILED_*
            Log.e(TAG, "advertise failed to start, errorCode=$errorCode")
        }
    }

    fun startAdvertising() {
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

    private var scanCallback: ScanCallback? = null

    fun startScanning(onFound: (PeerAdvertisement) -> Unit) {
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                Log.i(TAG, "saw device ${result.device.address} rssi=${result.rssi}")
                onFound(
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

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        // Without this filter, startScan(null, ...) reports every nearby BLE
        // advertiser (earbuds, watches, unrelated phones), not just peers
        // running this app — which silently corrupts discovery-latency
        // measurements with unrelated ambient devices.
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        scanner?.startScan(listOf(filter), settings, callback)
            ?: Log.e(TAG, "no BLE scanner available on this device")
    }

    fun stopScanning() {
        scanCallback?.let { scanner?.stopScan(it) }
        scanCallback = null
    }
}
