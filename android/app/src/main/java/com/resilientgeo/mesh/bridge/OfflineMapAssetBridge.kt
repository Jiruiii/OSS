package com.resilientgeo.mesh.bridge

import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.Executors

/** Streams bundled PMTiles from Flutter's AssetManager into app-private files. */
class OfflineMapAssetBridge(
    context: Context,
    messenger: BinaryMessenger,
) : MethodChannel.MethodCallHandler {

    private val applicationContext = context.applicationContext
    private val channel = MethodChannel(messenger, CHANNEL_NAME)
    private val executor = Executors.newSingleThreadExecutor()

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != METHOD_COPY_PMTILES) {
            result.notImplemented()
            return
        }

        val assets = call.argument<List<String>>(ARG_ASSETS)
        val versions = call.argument<Map<String, String>>("versions").orEmpty()
        if (assets.isNullOrEmpty()) {
            result.error(INVALID_ARGUMENTS, "copyPmtiles requires assets", null)
            return
        }

        executor.execute {
            try {
                val mapDirectory = File(applicationContext.filesDir, "maps")
                    .apply { mkdirs() }
                val paths = linkedMapOf<String, String>()
                for (asset in assets) {
                    val fileName = asset.substringAfterLast('/')
                    require(fileName.isNotEmpty() && fileName.endsWith(".pmtiles")) {
                        "Unsupported map asset: $asset"
                    }
                    val destination = File(mapDirectory, fileName)
                    val version = versions[asset]
                    val stamp = File(mapDirectory, "$fileName.version")
                    val cached = version != null && destination.isFile && destination.length() > 0 &&
                        stamp.isFile && stamp.readText() == "$version:${destination.length()}"
                    if (!cached) {
                        // Publish only a complete file. An interrupted install
                        // leaves the prior map available and no valid stamp.
                        val pending = File(mapDirectory, "$fileName.pending")
                        applicationContext.assets.open("flutter_assets/$asset").use { input ->
                            pending.outputStream().buffered(128 * 1024).use { output ->
                                input.copyTo(output, 128 * 1024)
                            }
                        }
                        java.nio.file.Files.move(pending.toPath(), destination.toPath(),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                            java.nio.file.StandardCopyOption.ATOMIC_MOVE)
                        if (version != null) stamp.writeText("$version:${destination.length()}")
                    }
                    paths[asset] = destination.absolutePath
                }
                runOnMain { result.success(paths) }
            } catch (error: Throwable) {
                runOnMain {
                    result.error(MAP_ASSET_ERROR, error.message, null)
                }
            }
        }
    }

    fun close() {
        channel.setMethodCallHandler(null)
        executor.shutdownNow()
    }

    private fun runOnMain(block: () -> Unit) {
        android.os.Handler(android.os.Looper.getMainLooper()).post(block)
    }

    private companion object {
        const val CHANNEL_NAME = "com.resilientgeo.mesh/offline_map_assets"
        const val METHOD_COPY_PMTILES = "copyPmtiles"
        const val ARG_ASSETS = "assets"
        const val INVALID_ARGUMENTS = "invalid_arguments"
        const val MAP_ASSET_ERROR = "map_asset_error"
    }
}
