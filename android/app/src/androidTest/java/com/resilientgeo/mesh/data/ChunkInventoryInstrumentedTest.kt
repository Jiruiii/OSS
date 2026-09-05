package com.resilientgeo.mesh.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Covers the inventory a node uses to answer "what do I already have?".
 *
 * Before this table existed, both HELLO summaries in the peer-sync demo
 * were hardcoded JSON, so a node that received a chunk still advertised
 * itself as empty — meaning it could never relay to a third device and the
 * mesh could not extend past the two phones whose fixtures were written by
 * hand. These assertions are the store-carry-forward precondition: after
 * applying a chunk, the node's own summary must name it.
 */
@RunWith(AndroidJUnit4::class)
class ChunkInventoryInstrumentedTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: ChunkDao

    private fun chunk(
        chunkId: String,
        version: Int = 136,
        manifestId: String = "resilientgeo-demo:manifest:136",
        priority: String = "CRITICAL",
        size: Long = 1147,
    ) = ChunkEntity(
        datasetId = "resilientgeo-demo",
        namespace = "official",
        chunkId = chunkId,
        manifestId = manifestId,
        datasetVersion = version,
        chunkHash = "sha256:$chunkId",
        sizeBytes = size,
        priority = priority,
        receivedAtEpochMillis = 1_756_000_000_000L,
    )

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java,
        ).build()
        dao = db.chunkDao()
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun anEmptyInventoryReportsNothingHeld() {
        assertEquals(0, dao.countSync())
        assertEquals(emptyList<ChunkEntity>(), dao.forDatasetSync("resilientgeo-demo", "official"))
    }

    @Test
    fun anAppliedChunkBecomesPartOfThisNodesInventory() {
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:dahu:shelter:000"))

        val held = dao.forDatasetSync("resilientgeo-demo", "official")

        assertEquals(1, held.size)
        assertEquals("resilientgeo-demo:chunk:136:dahu:shelter:000", held.single().chunkId)
        assertEquals(1147, held.single().sizeBytes)
    }

    @Test
    fun inventoryIsOrderedByChunkIdSoTwoNodesCompareStableSummaries() {
        // Insertion order deliberately not sorted: a summary whose chunk
        // order depended on arrival order would make two nodes holding the
        // same set look different.
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:wende:road:000"))
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:dahu:shelter:000"))
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:donghu:flood:000"))

        assertEquals(
            listOf(
                "resilientgeo-demo:chunk:136:dahu:shelter:000",
                "resilientgeo-demo:chunk:136:donghu:flood:000",
                "resilientgeo-demo:chunk:136:wende:road:000",
            ),
            dao.forDatasetSync("resilientgeo-demo", "official").map { it.chunkId },
        )
    }

    @Test
    fun reReceivingTheSameChunkDoesNotDuplicateIt() {
        // Opportunistic contact means the same chunk can legitimately
        // arrive twice from two different peers.
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:dahu:shelter:000"))
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:dahu:shelter:000"))

        assertEquals(1, dao.countSync())
    }

    @Test
    fun inventoryIsScopedByDatasetAndNamespace() {
        dao.upsertSync(chunk("resilientgeo-demo:chunk:136:dahu:shelter:000"))
        dao.upsertSync(
            chunk("resilientgeo-demo:chunk:136:dahu:shelter:000").copy(namespace = "crowd.reports"),
        )

        // Same chunk_id under a different namespace is a different row —
        // official and crowd data must never merge, per the data contract.
        assertEquals(2, dao.countSync())
        assertEquals(1, dao.forDatasetSync("resilientgeo-demo", "official").size)
        assertEquals(1, dao.forDatasetSync("resilientgeo-demo", "crowd.reports").size)
    }
}
