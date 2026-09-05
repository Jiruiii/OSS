package com.resilientgeo.mesh

import com.resilientgeo.mesh.bridge.FlutterMapBridge
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

/**
 * Launcher for the Flutter map surface.
 *
 * Android-owned Room, trust verification, TTL/version handling, Emergency
 * Mode, BLE, and transport activities remain in their existing classes. The
 * bridge is registered by Task 3 through configureFlutterEngine.
 */
class MainActivity : FlutterActivity() {
    private var mapBridge: FlutterMapBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        mapBridge?.close()
        mapBridge = FlutterMapBridge(applicationContext, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onDestroy() {
        mapBridge?.close()
        mapBridge = null
        super.onDestroy()
    }
}
