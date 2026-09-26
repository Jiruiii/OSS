package com.resilientgeo.mesh.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.resilientgeo.mesh.data.ChunkIngestResult
import com.resilientgeo.mesh.data.MeshRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Debug-build stand-in for the upstream/downstream government link that the
 * crowd-report plan leaves as future work. Registered only in
 * src/debug/AndroidManifest.xml, so release builds contain neither the class
 * nor the exported receiver.
 *
 * Export every held crowd report (own and relayed) for `pipeline/cli.mjs attest`:
 *
 *     adb shell am broadcast -a com.resilientgeo.mesh.debug.EXPORT_CROWD_REPORTS -n com.resilientgeo.mesh/.debug.CrowdDebugReceiver
 *     adb pull /sdcard/Android/data/com.resilientgeo.mesh/files/crowd-export/
 *
 * Import official chunks (e.g. the attestation bundle from `cli.mjs build`);
 * each one goes through the normal ChunkVerifier + EventIngestor path and is
 * then relayed by Emergency Mode like any other chunk:
 *
 *     adb push <bundle>/chunks/. /sdcard/Android/data/com.resilientgeo.mesh/files/chunk-import/
 *     adb shell am broadcast -a com.resilientgeo.mesh.debug.IMPORT_CHUNKS -n com.resilientgeo.mesh/.debug.CrowdDebugReceiver
 */
class CrowdDebugReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val appContext = context.applicationContext
        scope.launch {
            try {
                when (intent.action) {
                    ACTION_EXPORT -> export(appContext)
                    ACTION_IMPORT -> import(appContext)
                    else -> Log.w(TAG, "unknown action ${intent.action}")
                }
            } catch (error: Exception) {
                Log.e(TAG, "${intent.action} failed", error)
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun export(context: Context) {
        val dir = File(context.getExternalFilesDir(null), "crowd-export").apply { mkdirs() }
        val batch = MeshRepository(context).exportCrowdReports()
        val file = File(dir, "crowd-reports-${Instant.now().epochSecond}.json")
        file.writeText(batch.toString(2))
        Log.i(TAG, "exported ${batch.getJSONArray("events").length()} crowd report(s) to ${file.absolutePath}")
    }

    private suspend fun import(context: Context) {
        val dir = File(context.getExternalFilesDir(null), "chunk-import")
        val files = dir.listFiles { file -> file.extension == "json" }?.sortedBy { it.name }.orEmpty()
        val repository = MeshRepository(context)
        for (file in files) {
            when (val result = repository.ingestChunk(JSONObject(file.readText()))) {
                is ChunkIngestResult.Applied -> Log.i(TAG, "imported ${file.name}: ${result.eventResults}")
                is ChunkIngestResult.Rejected -> Log.w(TAG, "rejected ${file.name}: ${result.reason}")
            }
        }
        Log.i(TAG, "processed ${files.size} chunk file(s) from ${dir.absolutePath}")
    }

    private companion object {
        const val TAG = "CrowdDebugReceiver"
        const val ACTION_EXPORT = "com.resilientgeo.mesh.debug.EXPORT_CROWD_REPORTS"
        const val ACTION_IMPORT = "com.resilientgeo.mesh.debug.IMPORT_CHUNKS"
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
