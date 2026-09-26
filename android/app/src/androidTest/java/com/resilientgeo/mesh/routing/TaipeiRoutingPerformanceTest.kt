package com.resilientgeo.mesh.routing

import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Runs against real bundled data on USB devices; does not alter GPS or app data. */
@RunWith(AndroidJUnit4::class)
class TaipeiRoutingPerformanceTest {
    @Test fun regionalRoutesAndLatency() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val graphStart = System.nanoTime()
        val graph = RoadGraph.fromPrebuilt(context.assets.open(EvacuationRouteService.GRAPH_ASSET)) { stage ->
            Log.i("RoutingBenchmark", "load_stage=$stage elapsed_ms=${(System.nanoTime()-graphStart)/1e6}")
        }
        val graphMs = (System.nanoTime()-graphStart)/1e6
        Log.i("RoutingBenchmark","graph_load_ms=$graphMs nodes=${graph.nodeCount} edges=${graph.edgeCount}")
        // Station-adjacent street positions across both cities; the target is
        // another street coordinate, so this isolates routing from shelter status.
        val pairs = listOf(
            "taipei" to (LonLat(121.517,25.047) to LonLat(121.525,25.048)),
            "banqiao" to (LonLat(121.462,25.014) to LonLat(121.459,25.009)),
            "sanchong" to (LonLat(121.486,25.055) to LonLat(121.491,25.057)),
            "xindian" to (LonLat(121.537,24.967) to LonLat(121.533,24.973)),
            "tamsui" to (LonLat(121.445,25.168) to LonLat(121.441,25.171)),
            "cross_city_bridge" to (LonLat(121.506,25.062) to LonLat(121.492,25.063)),
        )
        val service = EvacuationRouteService({graph},{emptyList()})
        val timings = mutableListOf<Double>()
        for ((name,pair) in pairs) {
            val request = RouteRequest(pair.first,"benchmark:$name",pair.second,"walk")
            repeat(6) { iteration ->
                val start = System.nanoTime()
                val route = service.calculate(request)
                val ms = (System.nanoTime()-start)/1e6
                assertEquals(name,RouteStatus.OK,route.status)
                if (iteration > 0) timings += ms
                Log.i("RoutingBenchmark","$name iteration=$iteration elapsed_ms=$ms distance_m=${route.distanceM}")
            }
        }
        timings.sort()
        val p95 = timings[((timings.size-1)*.95).toInt()]
        Log.i("RoutingBenchmark","RESULT graph_load_ms=$graphMs warm_route_p95_ms=$p95 max_ms=${timings.last()}")
        assertTrue("graph load exceeded 5 s: $graphMs",graphMs < 5000)
        assertTrue("warm regional route p95 exceeded 500 ms: $p95",p95 < 500)
    }
}
