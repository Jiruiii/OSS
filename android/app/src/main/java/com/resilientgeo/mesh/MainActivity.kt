package com.resilientgeo.mesh

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.resilientgeo.mesh.data.toStoredEvent
import com.resilientgeo.mesh.databinding.ActivityMainBinding
import com.resilientgeo.mesh.map.MapFeature
import com.resilientgeo.mesh.ui.EventListAdapter
import com.resilientgeo.mesh.transport.BleSpikeActivity
import com.resilientgeo.mesh.ui.MainViewModel
import kotlinx.coroutines.launch

/**
 * Phase 1 single-device screen: Emergency Mode is always "on" here because
 * there is nothing else to toggle yet (no Peer Sync, no network calls at
 * all). The map and event list both read from Room, so killing the app,
 * turning off networking, and relaunching reproduces exactly the same
 * state — that is the acceptance check for this phase, not a demo trick.
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.eventRecyclerView.layoutManager = LinearLayoutManager(this)
        binding.eventRecyclerView.adapter = adapter

        binding.loadFixtureButton.setOnClickListener { viewModel.loadBundledFixture() }
        binding.openBleSpikeButton.setOnClickListener {
            startActivity(Intent(this, BleSpikeActivity::class.java))
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
