package com.resilientgeo.mesh.data

import android.bluetooth.BluetoothManager
import android.net.ConnectivityManager
import android.content.Context
import android.util.Log
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.resilientgeo.mesh.online.GovernmentFeedSync
import com.resilientgeo.mesh.online.FeedCursor
import com.resilientgeo.mesh.trust.TrustedKeyStore
import com.resilientgeo.mesh.emergency.AutoPeerSyncEngine
import com.resilientgeo.mesh.transport.BleGattTransport
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Explicit two-phone validation. Isolated Room/cache, no production preferences changed. */
@RunWith(AndroidJUnit4::class)
class GovernmentPeerInstrumentedTest {
    @Test fun publicHttpsReleaseVerifiesAndRepeatDoesNotDownloadChunks(): Unit = runBlocking {
        val url = InstrumentationRegistry.getArguments().getString("government_url")
        assumeTrue("Opt-in public HTTPS validation", url?.startsWith("https://") == true)
        val context: Context = ApplicationProvider.getApplicationContext()
        val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()
        val cache = File.createTempFile("government-https-", "", context.cacheDir).apply { delete(); mkdirs() }
        try {
            val repository = MeshRepository(context, db, cache)
            val trust = TrustedKeyStore.fromJson(context.assets.open("trust/trusted-keys.json").bufferedReader().use { it.readText() })
            var fetched = 0
            val sync = GovernmentFeedSync(trust, { request -> withContext(Dispatchers.IO) {
                val json = GovernmentFeedSync.download(request)
                fetched++
                if (fetched == 1 || fetched % 50 == 0) Log.i("GovernmentPeerTest", "PUBLIC_HTTPS_PROGRESS requests=$fetched")
                json
            } },
                { dataset, namespace, id -> repository.cachedChunkJson(dataset, namespace, id) },
                { repository.ingestChunk(it) is ChunkIngestResult.Applied }, includeArea = { area ->
                    area.startsWith("tw.630") || area.startsWith("tw.650") || area in setOf("tw", "tw.unknown")
                })
            val first = sync.sync(requireNotNull(url), FeedCursor())
            assertTrue("Expected real government chunks", first.downloaded > 0)
            assertEquals(first.downloaded, db.chunkDao().countSync())
            assertTrue(repository.allEventsSnapshot().isNotEmpty())
            val repeat = sync.sync(url, first.cursor)
            assertEquals(0, repeat.downloaded)
            assertEquals(first.cursor, repeat.cursor)
            Log.i("GovernmentPeerTest", "PUBLIC_HTTPS_OK revision=${first.cursor.revision} chunks=${first.downloaded} events=${repository.allEventsSnapshot().size}")
        } finally { db.close(); cache.deleteRecursively() }
    }
    @Test fun signedHttpDownloadThenOfflineBleRelay(): Unit = runBlocking {
        val role = InstrumentationRegistry.getArguments().getString("government_peer")
        assumeTrue("Opt-in paired-device government test", role in listOf("source", "receiver"))
        val context: Context = ApplicationProvider.getApplicationContext()
        val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()
        val cache = File.createTempFile("government-peer-", "", context.cacheDir).apply { delete(); mkdirs() }
        val start = File(context.cacheDir, "government-test-start")
        start.delete()
        val repository = MeshRepository(context, db, cache)
        val trust = TrustedKeyStore.fromJson(context.assets.open("trust/trusted-keys.json").bufferedReader().use { it.readText() })
        val radio = BleGattTransport(context, context.getSystemService(BluetoothManager::class.java).adapter)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        var engine: AutoPeerSyncEngine? = null
        try {
            if (role == "source") {
                val sync = GovernmentFeedSync(trust, { withContext(Dispatchers.IO) { GovernmentFeedSync.download(it) } },
                    { dataset, namespace, id -> repository.cachedChunkJson(dataset, namespace, id) },
                    { repository.ingestChunk(it) is ChunkIngestResult.Applied })
                val first = sync.sync("http://127.0.0.1:8787/", FeedCursor(), true)
                assertEquals("Hardware feed must contain one real government chunk", 1, first.downloaded)
                assertEquals(1, db.chunkDao().countSync())
                val repeat = sync.sync("http://127.0.0.1:8787/", first.cursor, true)
                assertEquals("Same release must not re-download chunks", 0, repeat.downloaded)
                Log.i("GovernmentPeerTest", "SOURCE_HTTP_READY revision=${first.cursor.revision}")
            } else assertEquals(0, db.chunkDao().countSync())
            Log.i("GovernmentPeerTest", "BARRIER_READY role=$role")
            withTimeout(120000) { while (!start.exists()) delay(250) }
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            withTimeout(30000) { while (connectivity.activeNetwork != null) delay(250) }
            Log.i("GovernmentPeerTest", "NO_INTERNET_CONFIRMED role=$role")
            val nodeId = "government-hardware-$role"
            engine = AutoPeerSyncEngine(transport = radio, localNodeId = nodeId,
                localSummaryProvider = { repository.allLocalPeerSummaries(nodeId) },
                chunkProvider = { dataset, namespace, id -> repository.cachedChunkJson(dataset, namespace, id) },
                chunkIngestor = { repository.ingestChunk(it) }, scope = scope,
                receptiveWindowMillis = 5000, syncCooldownMillis = 10000, failureCooldownMillis = 3000,
                onLog = { Log.i("GovernmentPeerTest", "[$role] $it") })
            engine.start()
            withTimeout(150000) {
                while (db.chunkDao().countSync() < 1 || engine.stats().peersSynced < 1) delay(250)
            }
            assertEquals(1, db.chunkDao().countSync())
            assertEquals(1, repository.allEventsSnapshot().size)
            if (role == "receiver") assertTrue(engine.stats().chunksApplied > 0)
            val summary = repository.allLocalPeerSummaries(nodeId).getJSONArray("datasets")
            val dataset = (0 until summary.length()).map { summary.getJSONObject(it) }
                .first { it.getString("dataset_id").startsWith("government-") }
            val chunkId = dataset.getJSONArray("chunks").getJSONObject(0).getString("chunk_id")
            assertNotNull(repository.cachedChunkJson(dataset.getString("dataset_id"), dataset.getString("namespace"), chunkId))
            Log.i("GovernmentPeerTest", "OFFLINE_RELAY_OK role=$role ${engine.stats()}")
        } finally {
            engine?.stop(); scope.cancel(); radio.teardown(); db.close(); cache.deleteRecursively(); start.delete()
        }
    }
}
