package com.resilientgeo.mesh.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.resilientgeo.mesh.data.EventEntity
import com.resilientgeo.mesh.data.MeshRepository
import com.resilientgeo.mesh.ingest.IngestResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = MeshRepository(application)

    private val _lastLoadSummary = MutableStateFlow<String?>(null)
    val lastLoadSummary: StateFlow<String?> = _lastLoadSummary.asStateFlow()

    // Defaults to off: MVP boundary requires the user to explicitly opt in,
    // never inferred from network/battery state. Pure state for now — no
    // foreground service, no BLE — that's the next task, wired in later
    // once this toggle exists for it to control.
    private val _emergencyModeEnabled = MutableStateFlow(false)
    val emergencyModeEnabled: StateFlow<Boolean> = _emergencyModeEnabled.asStateFlow()

    fun setEmergencyMode(enabled: Boolean) {
        _emergencyModeEnabled.value = enabled
    }

    val events: StateFlow<List<EventEntity>> = repository.observeEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun loadBundledFixture() {
        viewModelScope.launch {
            val results = repository.ingestBundledFixture()
            val inserted = results.count { it is IngestResult.Inserted }
            val updated = results.count { it is IngestResult.Updated }
            val rejected = results.size - inserted - updated
            _lastLoadSummary.value = "inserted=$inserted updated=$updated rejected=$rejected"
        }
    }
}
