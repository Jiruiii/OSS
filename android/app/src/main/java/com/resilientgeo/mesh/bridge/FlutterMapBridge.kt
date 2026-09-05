package com.resilientgeo.mesh.bridge

import android.content.Context
import com.resilientgeo.mesh.data.EventEntity
import com.resilientgeo.mesh.data.MeshRepository
import com.resilientgeo.mesh.ingest.IngestResult
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Android-owned bridge for the Flutter map. It reads verified events from the
 * repository and never gives Flutter a Room write path.
 */
class FlutterMapBridge(
    context: Context,
    messenger: BinaryMessenger,
    private val repository: MeshRepository = MeshRepository(context),
    private val emergencyMode: EmergencyModeController = EmergencyModeController(
        AndroidEmergencyModeServiceCommand(context),
        SharedPreferencesEmergencyModeState(context),
    ),
) : MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val methodChannel = MethodChannel(messenger, METHOD_CHANNEL_NAME)
    private val eventChannel = EventChannel(messenger, EVENT_CHANNEL_NAME)
    private var eventObservation: Job? = null

    init {
        methodChannel.setMethodCallHandler(this)
        eventChannel.setStreamHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            METHOD_GET_INITIAL_STATE -> getInitialState(result)
            METHOD_LOAD_BUNDLED_FIXTURE -> loadBundledFixture(result)
            METHOD_SET_EMERGENCY_MODE -> setEmergencyMode(call, result)
            else -> result.notImplemented()
        }
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventObservation?.cancel()
        if (events == null) return

        eventObservation = scope.launch {
            repository.observeEvents()
                .map { rows -> rows.toMessages() }
                .catch { error ->
                    events.error(EVENT_OBSERVATION_ERROR, error.message, null)
                }
                .collect { eventMessages ->
                    events.success(eventMessages)
                }
        }
    }

    override fun onCancel(arguments: Any?) {
        eventObservation?.cancel()
        eventObservation = null
    }

    /** Called by the host activity so neither channel retains a dead Activity/engine. */
    fun close() {
        eventObservation?.cancel()
        eventObservation = null
        methodChannel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
        scope.cancel()
    }

    private fun getInitialState(result: MethodChannel.Result) {
        scope.launch {
            try {
                val events = repository.observeEvents().first().toMessages()
                result.success(
                    mapOf(
                        "events" to events,
                        "emergency_mode_enabled" to emergencyMode.isEnabled,
                    ),
                )
            } catch (error: Throwable) {
                result.error(METHOD_ERROR, error.message, null)
            }
        }
    }

    private fun loadBundledFixture(result: MethodChannel.Result) {
        scope.launch {
            try {
                val results = repository.ingestBundledFixture()
                val inserted = results.count { it is IngestResult.Inserted }
                val updated = results.count { it is IngestResult.Updated }
                result.success(
                    mapOf(
                        "processed" to results.size,
                        "inserted" to inserted,
                        "updated" to updated,
                        "rejected" to results.size - inserted - updated,
                    ),
                )
            } catch (error: Throwable) {
                result.error(METHOD_ERROR, error.message, null)
            }
        }
    }

    private fun setEmergencyMode(call: MethodCall, result: MethodChannel.Result) {
        val arguments = call.arguments as? Map<*, *>
        val enabled = arguments?.get("enabled") as? Boolean
        if (enabled == null) {
            result.error(INVALID_ARGUMENTS, "setEmergencyMode requires boolean enabled", null)
            return
        }

        try {
            result.success(mapOf("enabled" to emergencyMode.setEnabled(enabled)))
        } catch (error: Throwable) {
            result.error(METHOD_ERROR, error.message, null)
        }
    }

    private fun List<EventEntity>.toMessages(): List<Map<String, Any?>> =
        map(EventPayloadMapper::toMessage)

    private companion object {
        const val METHOD_CHANNEL_NAME = "com.resilientgeo.mesh/map"
        const val EVENT_CHANNEL_NAME = "com.resilientgeo.mesh/events"
        const val METHOD_GET_INITIAL_STATE = "getInitialState"
        const val METHOD_LOAD_BUNDLED_FIXTURE = "loadBundledFixture"
        const val METHOD_SET_EMERGENCY_MODE = "setEmergencyMode"
        const val INVALID_ARGUMENTS = "invalid_arguments"
        const val METHOD_ERROR = "map_bridge_error"
        const val EVENT_OBSERVATION_ERROR = "event_observation_error"
    }
}
