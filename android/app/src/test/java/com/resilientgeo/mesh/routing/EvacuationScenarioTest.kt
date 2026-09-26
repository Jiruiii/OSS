package com.resilientgeo.mesh.routing

import com.resilientgeo.mesh.protocol.ChunkVerifier
import com.resilientgeo.mesh.trust.TestFixtures
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * Replays data/fixtures/neihu/evacuation-scenario.json the way a phone would:
 * signed chunks arrive, pass ChunkVerifier, their events join the snapshot, and
 * the recommendation (lowest Android route distance, as Flutter ranks it)
 * changes. See pipeline/tools/generate-evacuation-scenario.mjs.
 */
class EvacuationScenarioTest {
    private val now = Instant.parse("2026-09-26T09:00:00Z")
    private val scenario = JSONObject(File("../../data/fixtures/neihu/evacuation-scenario.json").readText())
    private val origin = scenario.getJSONObject("origin").let { LonLat(it.getDouble("lon"), it.getDouble("lat")) }
    private val shelters = scenario.getJSONArray("shelters").let { list ->
        (0 until list.length()).map { list.getJSONObject(it) }
            .associate { it.getString("name") to (it.getString("id") to LonLat(it.getDouble("lon"), it.getDouble("lat"))) }
    }
    private val graph = RoutingTestSupport.realGraph()

    private fun chunkEvents(name: String): List<String> {
        val text = checkNotNull(javaClass.classLoader?.getResourceAsStream("fixtures/evacuation-scenario/$name")) {
            "missing fixtures/evacuation-scenario/$name"
        }.bufferedReader().use { it.readText() }
        val verified = ChunkVerifier.verify(JSONObject(text), TestFixtures.trustedKeyStore(), now)
        assertTrue("$name must verify against the bundled trust store: $verified", verified is ChunkVerifier.Result.Valid)
        return (verified as ChunkVerifier.Result.Valid).events.map { it.toString() }
    }

    private suspend fun routes(events: List<String>): Map<String, RouteResult> {
        val service = EvacuationRouteService({ graph }, { events }, { now })
        return shelters.mapValues { (_, shelter) -> service.calculate(RouteRequest(origin, shelter.first, shelter.second, "walk")) }
    }

    private fun recommended(results: Map<String, RouteResult>): String =
        results.filterValues { it.status == RouteStatus.OK }.minByOrNull { it.value.distanceM!! }!!.key

    @Test
    fun `mesh events reroute and then redirect the evacuation`() = runTest {
        val closure = chunkEvents("step2-road-closed.json")
        val shelterFull = chunkEvents("step3-shelter-full.json")
        val closureId = JSONObject(closure.single()).getString("event_id")

        val step1 = routes(emptyList())
        assertEquals("西湖國小", recommended(step1))
        val baseline = step1.getValue("西湖國小")
        assertTrue(baseline.distanceM!! in 300.0..450.0)

        val step2 = routes(closure)
        assertEquals("西湖國小", recommended(step2))
        val rerouted = step2.getValue("西湖國小")
        assertTrue("detour should be longer", rerouted.distanceM!! > baseline.distanceM!! + 50)
        assertEquals(listOf(closureId), rerouted.blockedEventIds)
        assertTrue(rerouted.polyline != baseline.polyline)

        val step3 = routes(closure + shelterFull)
        assertEquals(RouteStatus.NO_ROUTE, step3.getValue("西湖國小").status)
        assertEquals("SHELTER_FULL", step3.getValue("西湖國小").warnings.first().code)
        assertEquals("西湖國中", recommended(step3))
    }
}
