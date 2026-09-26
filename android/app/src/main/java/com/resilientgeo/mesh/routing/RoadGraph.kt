package com.resilientgeo.mesh.routing

import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Walking graph built from the bundled OSM road snapshot
 * (`assets/routing/walk-roads.json`, produced by
 * `pipeline/tools/generate-walk-graph.mjs`).
 *
 * Vertices shared by several ways (keyed at 1e-7 degree) become one node, and
 * every pair of consecutive vertices becomes one undirected edge carrying its
 * OSM way id, road class and haversine length. Node and edge ids follow file
 * order, which the generator sorts by way id, so the same asset always yields
 * the same ids and therefore the same routes.
 */
class RoadGraph private constructor(
    val graphVersion: String,
    private val nodeLon: DoubleArray,
    private val nodeLat: DoubleArray,
    private val edgeFrom: IntArray,
    private val edgeTo: IntArray,
    private val edgeLength: DoubleArray,
    private val edgeWay: LongArray,
    private val edgeClass: Array<String>,
    private val adjacencyStart: IntArray,
    private val adjacencyEdges: IntArray,
    private val edgesByWay: Map<Long, IntArray>,
    private val grid: Map<Long, IntArray>,
    private val component: IntArray,
    private val mainComponent: Int,
) {
    val nodeCount: Int get() = nodeLon.size
    val edgeCount: Int get() = edgeFrom.size

    fun node(id: Int): LonLat = LonLat(nodeLon[id], nodeLat[id])
    fun edgeFrom(edge: Int): Int = edgeFrom[edge]
    fun edgeTo(edge: Int): Int = edgeTo[edge]
    fun edgeLengthMeters(edge: Int): Double = edgeLength[edge]
    fun edgeWayId(edge: Int): Long = edgeWay[edge]
    fun edgeRoadClass(edge: Int): String = edgeClass[edge]

    fun otherEnd(edge: Int, node: Int): Int = if (edgeFrom[edge] == node) edgeTo[edge] else edgeFrom[edge]

    /** Edge ids touching [node], in ascending edge-id order. */
    inline fun forEachEdgeOf(node: Int, action: (Int) -> Unit) {
        for (index in adjacencyRange(node)) action(adjacencyEdge(index))
    }

    fun adjacencyRange(node: Int): IntRange = adjacencyStart[node] until adjacencyStart[node + 1]
    fun adjacencyEdge(index: Int): Int = adjacencyEdges[index]

    fun edgesForWay(wayId: Long): IntArray = edgesByWay[wayId] ?: IntArray(0)

    fun edgeBBox(edge: Int): BBox {
        val a = edgeFrom[edge]
        val b = edgeTo[edge]
        return BBox(
            minOf(nodeLon[a], nodeLon[b]),
            minOf(nodeLat[a], nodeLat[b]),
            maxOf(nodeLon[a], nodeLon[b]),
            maxOf(nodeLat[a], nodeLat[b]),
        )
    }

    fun isInMainNetwork(node: Int): Boolean = component[node] == mainComponent

    /**
     * Nearest node within [maxMeters], ties broken by lower node id; null when
     * none is that close. A node on the main connected network wins over a
     * closer one on a stray OSM fragment (about 60 small pieces in the Neihu
     * snapshot), otherwise a shelter next to such a fragment would look
     * unreachable from everywhere.
     */
    fun nearestNode(point: LonLat, maxMeters: Double = SNAP_LIMIT_METERS): Int? {
        if (!point.isValid) return null
        val cellMetersLon = CELL_DEGREES * GeoMath.METERS_PER_DEGREE_LAT * cos(Math.toRadians(point.lat))
        val cellMetersLat = CELL_DEGREES * GeoMath.METERS_PER_DEGREE_LAT
        val reachLon = ceil(maxMeters / cellMetersLon).toInt()
        val reachLat = ceil(maxMeters / cellMetersLat).toInt()
        val cx = cellIndex(point.lon)
        val cy = cellIndex(point.lat)
        var best = -1
        var bestDistance = Double.MAX_VALUE
        var bestMain = -1
        var bestMainDistance = Double.MAX_VALUE
        for (dx in -reachLon..reachLon) {
            for (dy in -reachLat..reachLat) {
                val candidates = grid[cellKey(cx + dx, cy + dy)] ?: continue
                for (id in candidates) {
                    val distance = GeoMath.haversineMeters(point, node(id))
                    if (distance < bestDistance || (distance == bestDistance && id < best)) {
                        best = id
                        bestDistance = distance
                    }
                    if (isInMainNetwork(id) &&
                        (distance < bestMainDistance || (distance == bestMainDistance && id < bestMain))
                    ) {
                        bestMain = id
                        bestMainDistance = distance
                    }
                }
            }
        }
        return when {
            bestMain >= 0 && bestMainDistance <= maxMeters -> bestMain
            best >= 0 && bestDistance <= maxMeters -> best
            else -> null
        }
    }

    data class Way(val wayId: Long, val roadClass: String, val coordinates: List<LonLat>)

    companion object {
        /** Beyond this the origin/shelter is treated as off the offline network. */
        const val SNAP_LIMIT_METERS = 300.0
        private const val CELL_DEGREES = 0.001

        /**
         * Walkable classes from the routing plan; motorway, trunk (and their
         * links), elevator, bus_stop and corridor are excluded.
         */
        val WALKABLE_CLASSES = setOf(
            "footway", "path", "pedestrian", "steps", "residential", "living_street", "service",
            "unclassified", "tertiary", "secondary", "primary", "track", "cycleway",
            "tertiary_link", "secondary_link", "primary_link",
        )

        fun fromWalkRoadsJson(text: String): RoadGraph {
            val root = JSONObject(text)
            require(root.optString("schema_version") == "walk-roads-v0") { "not a walk-roads-v0 asset" }
            val classes = root.getJSONArray("road_classes")
            val ways = root.getJSONArray("ways")
            val parsed = ArrayList<Way>(ways.length())
            for (i in 0 until ways.length()) {
                val way = ways.getJSONArray(i)
                val flat = way.getJSONArray(2)
                val coordinates = ArrayList<LonLat>(flat.length() / 2)
                for (j in 0 until flat.length() - 1 step 2) coordinates += LonLat(flat.getDouble(j), flat.getDouble(j + 1))
                parsed += Way(way.getLong(0), classes.getString(way.getInt(1)), coordinates)
            }
            return fromWays(root.getString("graph_version"), parsed)
        }

        fun fromWays(graphVersion: String, ways: List<Way>): RoadGraph {
            val nodeIds = HashMap<Long, Int>()
            val lons = ArrayList<Double>()
            val lats = ArrayList<Double>()
            val from = ArrayList<Int>()
            val to = ArrayList<Int>()
            val lengths = ArrayList<Double>()
            val wayIds = ArrayList<Long>()
            val classes = ArrayList<String>()

            fun nodeFor(point: LonLat): Int {
                val key = coordinateKey(point)
                return nodeIds.getOrPut(key) {
                    lons += point.lon
                    lats += point.lat
                    lons.size - 1
                }
            }

            for (way in ways) {
                if (way.roadClass !in WALKABLE_CLASSES) continue
                var previous = -1
                for (point in way.coordinates) {
                    if (!point.isValid) continue
                    val current = nodeFor(point)
                    if (previous >= 0 && previous != current) {
                        from += previous
                        to += current
                        lengths += GeoMath.haversineMeters(LonLat(lons[previous], lats[previous]), point)
                        wayIds += way.wayId
                        classes += way.roadClass
                    }
                    previous = current
                }
            }

            val nodeCount = lons.size
            val degree = IntArray(nodeCount + 1)
            for (e in from.indices) {
                degree[from[e]]++
                degree[to[e]]++
            }
            val start = IntArray(nodeCount + 1)
            for (n in 0 until nodeCount) start[n + 1] = start[n] + degree[n]
            val fill = start.copyOf()
            val adjacency = IntArray(start[nodeCount])
            for (e in from.indices) {
                adjacency[fill[from[e]]++] = e
                adjacency[fill[to[e]]++] = e
            }

            val byWay = HashMap<Long, MutableList<Int>>()
            for (e in wayIds.indices) byWay.getOrPut(wayIds[e]) { mutableListOf() } += e

            val component = IntArray(nodeCount) { -1 }
            val componentSizes = mutableListOf<Int>()
            for (startNode in 0 until nodeCount) {
                if (component[startNode] >= 0) continue
                val id = componentSizes.size
                var size = 0
                val stack = ArrayDeque<Int>().apply { addLast(startNode) }
                component[startNode] = id
                while (stack.isNotEmpty()) {
                    val current = stack.removeLast()
                    size++
                    for (index in start[current] until start[current + 1]) {
                        val edge = adjacency[index]
                        val other = if (from[edge] == current) to[edge] else from[edge]
                        if (component[other] < 0) {
                            component[other] = id
                            stack.addLast(other)
                        }
                    }
                }
                componentSizes += size
            }
            val mainComponent = componentSizes.indices.maxByOrNull { componentSizes[it] } ?: -1

            val cells = HashMap<Long, MutableList<Int>>()
            for (n in 0 until nodeCount) {
                cells.getOrPut(cellKey(cellIndex(lons[n]), cellIndex(lats[n]))) { mutableListOf() } += n
            }

            return RoadGraph(
                graphVersion = graphVersion,
                nodeLon = lons.toDoubleArray(),
                nodeLat = lats.toDoubleArray(),
                edgeFrom = from.toIntArray(),
                edgeTo = to.toIntArray(),
                edgeLength = lengths.toDoubleArray(),
                edgeWay = wayIds.toLongArray(),
                edgeClass = classes.toTypedArray(),
                adjacencyStart = start,
                adjacencyEdges = adjacency,
                edgesByWay = byWay.mapValues { it.value.toIntArray() },
                grid = cells.mapValues { it.value.toIntArray() },
                component = component,
                mainComponent = mainComponent,
            )
        }

        private fun coordinateKey(point: LonLat): Long {
            val lon = (point.lon * 1e7).roundToLong()
            val lat = (point.lat * 1e7).roundToLong()
            return (lon shl 32) xor (lat and 0xffffffffL)
        }

        private fun cellIndex(degrees: Double): Int = floor(degrees / CELL_DEGREES).toInt()

        private fun cellKey(x: Int, y: Int): Long = (x.toLong() shl 32) xor (y.toLong() and 0xffffffffL)
    }
}
