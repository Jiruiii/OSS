package com.resilientgeo.mesh.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The packaged nationwide shelter layer verifies on a real device and writes
 * VerifiedLayerCache. The second load in this process comes from the
 * in-memory memo; across a real app restart it would come from the file this
 * test asserts exists. Prints both timings so the first-launch cost on this
 * device is visible in the log.
 */
@RunWith(AndroidJUnit4::class)
class StaticLayerInstrumentedTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun packagedSheltersVerifyAndLaterLoadsUseTheCache() {
        File(context.noBackupFilesDir, "verified-layers").deleteRecursively()

        val coldStart = System.nanoTime()
        val first = runBlocking { MeshRepository(context).verifiedStaticFeatures() }
        val coldMs = (System.nanoTime() - coldStart) / 1_000_000

        val shelters = first.filter { it["kind"] == "shelter" }
        assertTrue("expected the nationwide shelter layer, got ${shelters.size}", shelters.size > 5_000)
        assertTrue(shelters.any { it["name"] == "西湖國小" })
        assertTrue(File(context.noBackupFilesDir, "verified-layers").listFiles().orEmpty().isNotEmpty())

        val warmStart = System.nanoTime()
        val second = runBlocking { MeshRepository(context).verifiedStaticFeatures() }
        val warmMs = (System.nanoTime() - warmStart) / 1_000_000
        println("StaticLayerInstrumentedTest: first load $coldMs ms, second load $warmMs ms")

        assertEquals(first.size, second.size)
        assertEquals(first.map { it["id"] }, second.map { it["id"] })
    }
}
