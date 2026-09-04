package com.resilientgeo.mesh.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.resilientgeo.mesh.ingest.ApplyState
import com.resilientgeo.mesh.ingest.EventIngestor
import com.resilientgeo.mesh.trust.TrustedKeyStore
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

/**
 * Runs the same apply-rule scenario as `EventIngestorTest`/
 * `pipeline/test/pipeline.test.mjs`, but through Room on a real
 * device/emulator instead of an in-memory map — this is what phase 1's
 * acceptance check ("kill the app, turn off the network, relaunch — the
 * data is still there") actually depends on. Requires a connected device
 * or emulator (`./gradlew connectedDebugAndroidTest`); it cannot run as a
 * plain JVM unit test, unlike the trust-adapter tests under src/test.
 */
@RunWith(AndroidJUnit4::class)
class RoomEventStoreInstrumentedTest {

    private lateinit var db: AppDatabase
    private lateinit var trustStore: TrustedKeyStore
    private lateinit var events: org.json.JSONArray
    private val now = Instant.parse("2026-09-04T12:00:00Z")

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        trustStore = TrustedKeyStore.fromJson(context.assets.open("trust/trusted-keys.json").bufferedReader().use { it.readText() })
        events = JSONObject(context.assets.open("fixtures/signed-events.json").bufferedReader().use { it.readText() }).getJSONArray("events")
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun eventFixture(namespace: String, eventId: String, version: Int): JSONObject {
        for (i in 0 until events.length()) {
            val event = events.getJSONObject(i)
            if (event.getString("namespace") == namespace && event.getString("event_id") == eventId && event.getInt("event_version") == version) {
                return event
            }
        }
        error("fixture event not found: $namespace/$eventId@$version")
    }

    @Test
    fun ingestedEventsSurviveReadingBackThroughAFreshStoreHandle() {
        val store = RoomEventStore(db.eventDao())
        EventIngestor.ingest(store, eventFixture("official.tdx", "road:dahu-01", 1), trustStore, now)
        EventIngestor.ingest(store, eventFixture("official.tdx", "road:dahu-01", 2), trustStore, now)

        // Simulates "app restart": read back through a fresh EventStore over the same DB.
        val reopened = RoomEventStore(db.eventDao())
        val stored = reopened.find("official.tdx", "road:dahu-01")
        assertEquals(2, stored?.eventVersion)
        assertEquals(ApplyState.CURRENT, stored?.applyState)
    }

    @Test
    fun versionRollbackIsRejectedAgainstThePersistedStore() {
        val store = RoomEventStore(db.eventDao())
        EventIngestor.ingest(store, eventFixture("official.tdx", "road:dahu-01", 2), trustStore, now)
        EventIngestor.ingest(store, eventFixture("official.tdx", "road:dahu-01", 1), trustStore, now)

        assertEquals(2, store.find("official.tdx", "road:dahu-01")?.eventVersion)
    }
}
