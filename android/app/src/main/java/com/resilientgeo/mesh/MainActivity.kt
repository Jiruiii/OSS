package com.resilientgeo.mesh

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.resilientgeo.mesh.data.toStoredEvent
import com.resilientgeo.mesh.databinding.ActivityMainBinding
import com.resilientgeo.mesh.emergency.EmergencyModeService
import com.resilientgeo.mesh.map.MapFeature
import com.resilientgeo.mesh.ui.EventListAdapter
import com.resilientgeo.mesh.transport.BleSpikeActivity
import com.resilientgeo.mesh.transport.NearbyTransportSpikeActivity
import com.resilientgeo.mesh.transport.WifiDirectTransportSpikeActivity
import com.resilientgeo.mesh.ui.MainViewModel
import kotlinx.coroutines.launch

/**
 * Phase 1 single-device screen. The map and event list both read from
 * Room, so killing the app, turning off networking, and relaunching
 * reproduces exactly the same state — that is the acceptance check for
 * this phase, not a demo trick.
 *
 * Emergency Mode is a manual toggle (乙): it defaults to off and is never
 * inferred from network/battery state, per the MVP boundary in
 * team-assignments.md ("使用者手動開啟有明顯狀態提示"). The toggle now drives
 * EmergencyModeService's lifecycle directly — 甲's stub previously started
 * unconditionally in onCreate to prove background/lock-screen survival;
 * now that a real toggle exists, the service starts when the user turns
 * the switch on and stops when they turn it off, instead of always
 * running. Worth telling 甲 this changed the service's trigger point.
 *
 * This is the app's launcher activity; module C's Stage 0 BLE spike
 * (BleSpikeActivity) is reachable from the button below instead of being
 * a separate entry point — see AndroidManifest.xml for why.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: MainViewModel by lazy {
        ViewModelProvider(this)[MainViewModel::class.java]
    }
    private val adapter = EventListAdapter()

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* EmergencyModeService already started either way — see its own doc comment. */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Android 15+ enforces edge-to-edge for apps targeting SDK 35+ (this
        // project targets 37) — there is no opt-out API anymore. Content
        // draws under the status bar unless a view explicitly consumes the
        // inset itself, so push the whole screen down by the status bar's
        // height. This screen has one column, so padding the root is enough;
        // a multi-pane layout would need to apply this to just the top row.
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            view.updatePadding(top = statusBars.top)
            insets
        }

        binding.eventRecyclerView.layoutManager = LinearLayoutManager(this)
        binding.eventRecyclerView.adapter = adapter

        binding.emergencyModeSwitch.setOnCheckedChangeListener { _, isChecked ->
            viewModel.setEmergencyMode(isChecked)
        }

        binding.loadFixtureButton.setOnClickListener { viewModel.loadBundledFixture() }
        binding.openBleSpikeButton.setOnClickListener {
            startActivity(Intent(this, BleSpikeActivity::class.java))
        }
        binding.openNearbyTransportSpikeButton.setOnClickListener {
            startActivity(Intent(this, NearbyTransportSpikeActivity::class.java))
        }
        binding.openWifiDirectSpikeButton.setOnClickListener {
            startActivity(Intent(this, WifiDirectTransportSpikeActivity::class.java))
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.events.collect { entities ->
                        adapter.submitList(entities)
                        binding.offlineMapView.setFeatures(entities.mapNotNull { entity ->
                            MapFeature.from(entity.toStoredEvent())
                        })
                    }
                }
                launch {
                    viewModel.emergencyModeEnabled.collect { enabled ->
                        // Setting isChecked to its current value is a no-op in
                        // Android (CompoundButton only fires listeners on an
                        // actual change), so this can't loop back into
                        // setOnCheckedChangeListener above.
                        binding.emergencyModeSwitch.isChecked = enabled
                        binding.emergencyModeLabel.text = getString(
                            if (enabled) R.string.emergency_mode_on else R.string.emergency_mode_off,
                        )
                        binding.emergencyModeLabel.setTextColor(
                            if (enabled) 0xFF4FC3F7.toInt() else 0xFF78909C.toInt(),
                        )

                        if (enabled) {
                            ContextCompat.startForegroundService(
                                this@MainActivity,
                                Intent(this@MainActivity, EmergencyModeService::class.java),
                            )
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                            ) {
                                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                        } else {
                            stopService(Intent(this@MainActivity, EmergencyModeService::class.java))
                        }
                    }
                }
                launch {
                    viewModel.lastLoadSummary.collect { summary ->
                        if (summary != null) {
                            Toast.makeText(this@MainActivity, summary, Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }
    }
}
