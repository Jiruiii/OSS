package com.resilientgeo.mesh.routing

import com.resilientgeo.mesh.routing.RoutingTestSupport.grid
import com.resilientgeo.mesh.routing.RoutingTestSupport.p
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoadGraphTest {

    @Test
    fun `tiny grid has the expected nodes and edges and drops excluded classes`() {
        val graph = grid()
        assertEquals(9, graph.nodeCount)
        assertEquals(12, graph.edgeCount)
        assertEquals(0, graph.edgesForWay(900L).size)
        assertEquals(2, graph.edgesForWay(100L).size)
        assertEquals("footway", graph.edgeRoadClass(graph.edgesForWay(201L).first()))
    }

    @Test
    fun `shared vertices merge into one node`() {
        val graph = grid()
        // Node 4 (the centre) is shared by way 101 and way 201.
        val centre = graph.nearestNode(p(1, 1))!!
        var degree = 0
        graph.forEachEdgeOf(centre) { degree++ }
        assertEquals(4, degree)
        assertEquals(p(1, 1), graph.node(centre))
    }

    @Test
    fun `edge lengths are haversine metres`() {
        val graph = grid()
        val edge = graph.edgesForWay(100L).first()
        assertEquals(GeoMath.haversineMeters(p(0, 0), p(1, 0)), graph.edgeLengthMeters(edge), 1e-9)
    }

    @Test
    fun `nearest node snaps within 300 m and refuses beyond`() {
        val graph = grid()
        assertEquals(graph.nearestNode(p(0, 0)), graph.nearestNode(LonLat(121.4999, 24.9999)))
        assertEquals(graph.nearestNode(p(2, 2)), graph.nearestNode(LonLat(121.5045, 25.002)))
        assertNull(graph.nearestNode(LonLat(121.506, 25.002)))
        assertNull(graph.nearestNode(LonLat(Double.NaN, 25.0)))
    }

    @Test
    fun `snapping prefers the main network over a closer stray fragment`() {
        val ways = (0..2).map { y -> RoadGraph.Way(100L + y, "residential", (0..2).map { p(it, y) }) } +
            (0..2).map { x -> RoadGraph.Way(200L + x, "footway", (0..2).map { p(x, it) }) } +
            RoadGraph.Way(300L, "footway", listOf(LonLat(121.50240, 25.00240), LonLat(121.50260, 25.00260)))
        val graph = RoadGraph.fromWays("fragment", ways)
        val query = LonLat(121.50250, 25.00250)
        val snapped = graph.nearestNode(query)!!
        assertEquals(p(2, 2), graph.node(snapped))
        assertTrue(graph.isInMainNetwork(snapped))
        // With no main-network node in range, the fragment is still better than nothing.
        val fallback = graph.nearestNode(query, maxMeters = 30.0)!!
        assertTrue(!graph.isInMainNetwork(fallback))
    }

    @Test
    fun `the real Neihu walk graph is one network`() {
        val started = System.nanoTime()
        val graph = RoutingTestSupport.realGraph()
        val builtMs = (System.nanoTime() - started) / 1_000_000
        val component = IntArray(graph.nodeCount) { -1 }
        var largest = 0
        var next = 0
        for (start in 0 until graph.nodeCount) {
            if (component[start] >= 0) continue
            var size = 0
            val stack = ArrayDeque(listOf(start))
            component[start] = next
            while (stack.isNotEmpty()) {
                val node = stack.removeLast()
                size++
                graph.forEachEdgeOf(node) { edge ->
                    val other = graph.otherEnd(edge, node)
                    if (component[other] < 0) {
                        component[other] = next
                        stack.addLast(other)
                    }
                }
            }
            largest = maxOf(largest, size)
            next++
        }
        val share = largest.toDouble() / graph.nodeCount
        println("walk graph ${graph.graphVersion}: ${graph.nodeCount} nodes, ${graph.edgeCount} edges, largest component ${"%.1f".format(share * 100)}%, built in $builtMs ms (JVM)")
        assertTrue("largest component only ${share * 100}%", share >= 0.9)
    }
}
