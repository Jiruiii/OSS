package com.resilientgeo.mesh.bridge

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.resilientgeo.mesh.emergency.EmergencyModeService

/** The small command boundary makes the existing foreground service testable. */
interface EmergencyModeServiceCommand {
    fun start()
    fun stop()
}

/** Persists only the user's explicit Emergency Mode choice, not any event data. */
interface EmergencyModeState {
    var isEnabled: Boolean
}

class EmergencyModeController(
    private val command: EmergencyModeServiceCommand,
    private val state: EmergencyModeState,
) {
    val isEnabled: Boolean
        get() = state.isEnabled

    fun setEnabled(enabled: Boolean): Boolean {
        if (enabled) {
            command.start()
        } else {
            command.stop()
        }
        state.isEnabled = enabled
        return enabled
    }
}

class AndroidEmergencyModeServiceCommand(context: Context) : EmergencyModeServiceCommand {
    private val appContext = context.applicationContext

    override fun start() {
        ContextCompat.startForegroundService(
            appContext,
            Intent(appContext, EmergencyModeService::class.java),
        )
    }

    override fun stop() {
        appContext.stopService(Intent(appContext, EmergencyModeService::class.java))
    }
}

class SharedPreferencesEmergencyModeState(context: Context) : EmergencyModeState {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    override var isEnabled: Boolean
        get() = preferences.getBoolean(KEY_ENABLED, false)
        set(value) {
            preferences.edit().putBoolean(KEY_ENABLED, value).apply()
        }

    private companion object {
        const val PREFERENCES_NAME = "emergency_mode"
        const val KEY_ENABLED = "enabled"
    }
}
