package com.resilientgeo.mesh.routing

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.InputStream
import java.util.zip.GZIPInputStream
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Offline walking graph. Production uses prebuilt Taipei/New Taipei arrays
 * from tools/maps/build_taipei_walk_graph.py, preserving shared OSM node IDs
 * and pedestrian direction flags. The original Neihu JSON/fromWays path
 * remains available for compatibility and golden tests; that legacy path
 * merges vertices by coordinates and treats segments as undirected.
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
    val coverageName: String = "內湖區",
    private val directions: ByteArray? = null,
    private val edgeGrid: Map<Long, IntArray>? = null,
) {
    private val bounds = if (nodeLon.isEmpty()) null else BBox(
        nodeLon.minOrNull()!!,nodeLat.minOrNull()!!,nodeLon.maxOrNull()!!,nodeLat.maxOrNull()!!)
    val nodeCount: Int get() = nodeLon.size
    val edgeCount: Int get() = edgeFrom.size

    fun node(id: Int): LonLat = LonLat(nodeLon[id], nodeLat[id])
    fun edgeFrom(edge: Int): Int = edgeFrom[edge]
    fun edgeTo(edge: Int): Int = edgeTo[edge]
    fun edgeLengthMeters(edge: Int): Double = edgeLength[edge]
    fun edgeWayId(edge: Int): Long = edgeWay[edge]
    fun edgeRoadClass(edge: Int): String = edgeClass[edge]

    fun canWalkFrom(edge: Int, node: Int): Boolean {
        val flags = directions?.get(edge)?.toInt() ?: 3
        return flags and (if (edgeFrom[edge] == node) 1 else 2) != 0
    }

    /** Indexed candidate edges, including segments crossing a cell boundary. */
    fun edgesNear(box: BBox): IntArray {
        val indexed = edgeGrid ?: return (0 until edgeCount).filter { edgeBBox(it).intersects(box) }.toIntArray()
        val left = floor(box.minLon / EDGE_CELL_DEGREES).toInt()
        val right = floor(box.maxLon / EDGE_CELL_DEGREES).toInt()
        val bottom = floor(box.minLat / EDGE_CELL_DEGREES).toInt()
        val top = floor(box.maxLat / EDGE_CELL_DEGREES).toInt()
        if ((right.toLong() - left + 1) * (top.toLong() - bottom + 1) > indexed.size * 2L) {
            return (0 until edgeCount).filter { edgeBBox(it).intersects(box) }.toIntArray()
        }
        val candidates = HashSet<Int>()
        for (x in left..right) for (y in bottom..top) {
            indexed[cellKey(x, y)]?.forEach { edge ->
                if (edgeBBox(edge).intersects(box)) candidates.add(edge)
            }
        }
        return candidates.toIntArray().apply { sort() }
    }

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
        val extent = bounds?.expandedByMeters(maxMeters) ?: return null
        if (point.lon !in extent.minLon..extent.maxLon || point.lat !in extent.minLat..extent.maxLat) return null
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
        private const val EDGE_CELL_DEGREES = 0.01

        /** Load build-time arrays directly, avoiding JSON objects and phone-side graph construction. */
        fun fromPrebuilt(input: InputStream, onStep: ((String) -> Unit)? = null): RoadGraph =
            // Buffer compressed reads too: AssetManager's JNI boundary must not
            // be crossed once per default 512-byte inflater refill.
            DataInputStream(BufferedInputStream(
                GZIPInputStream(BufferedInputStream(input, 128 * 1024), 128 * 1024),
                64 * 1024,
            )).use { data ->
                val magic = ByteArray(8).also(data::readFully)
                require(magic.contentEquals("RGMWALK1".toByteArray(Charsets.US_ASCII))) { "invalid walk graph" }
                fun text(): String {
                    val count = data.readInt()
                    require(count in 1..4096)
                    return ByteArray(count).also(data::readFully).toString(Charsets.UTF_8)
                }
                val version = text()
                val coverage = text()
                val nodes = data.readInt()
                val edges = data.readInt()
                require(nodes in 1..5_000_000 && edges in 1..10_000_000)
                val lons = DoubleArray(nodes)
                val lats = DoubleArray(nodes)
                for (n in 0 until nodes) {
                    lons[n] = data.readInt() / 1e7
                    lats[n] = data.readInt() / 1e7
                    require(LonLat(lons[n], lats[n]).isValid)
                }
                onStep?.invoke("nodes")
                val from = IntArray(edges)
                val to = IntArray(edges)
                val lengths = DoubleArray(edges)
                val ways = LongArray(edges)
                val classes = arrayOfNulls<String>(edges)
                val direction = ByteArray(edges)
                val catalog = WALKABLE_CLASSES.toList()
                for (e in 0 until edges) {
                    from[e] = data.readInt()
                    to[e] = data.readInt()
                    lengths[e] = data.readFloat().toDouble()
                    ways[e] = data.readLong()
                    classes[e] = catalog[data.readUnsignedByte()]
                    direction[e] = data.readByte()
                    require(from[e] in 0 until nodes && to[e] in 0 until nodes && lengths[e].isFinite() && lengths[e] > 0)
                    require(direction[e].toInt() in 1..3)
                    if (e > 0) require(ways[e] >= ways[e-1]) { "unsorted walk ways" }
                }
                onStep?.invoke("edges")
                val start = IntArray(nodes + 1) { data.readInt() }
                require(start[0] == 0 && start[nodes] == edges * 2)
                for (n in 0 until nodes) require(start[n] <= start[n + 1])
                val adjacency = IntArray(edges * 2) { data.readInt().also { require(it in 0 until edges) } }
                val components = IntArray(nodes) { data.readInt() }
                val main = data.readInt()
                onStep?.invoke("adjacency_components")
                fun grid(limit: Int): Map<Long, IntArray> {
                    val count = data.readInt()
                    require(count in 0..5_000_000)
                    val result = HashMap<Long, IntArray>(count)
                    repeat(count) {
                        val x = data.readInt()
                        val y = data.readInt()
                        val size = data.readInt()
                        require(size in 1..limit)
                        result[cellKey(x, y)] = IntArray(size) { data.readInt().also { require(it in 0 until limit) } }
                    }
                    return result
                }
                val nodeGrid = grid(nodes)
                val roadGrid = grid(edges)
                onStep?.invoke("spatial_indexes")
                require(data.read() == -1) { "trailing walk graph data" }
                // The generator sorts edges by OSM way. Build each range
                // once instead of boxing/hashing a Long for every road segment.
                val byWay = HashMap<Long, IntArray>()
                var first = 0
                while (first < edges) {
                    var end = first + 1
                    while (end < edges && ways[end] == ways[first]) end++
                    byWay[ways[first]] = IntArray(end-first) { first+it }
                    first = end
                }
                onStep?.invoke("way_index")
                @Suppress("UNCHECKED_CAST")
                RoadGraph(version, lons, lats, from, to, lengths, ways, classes as Array<String>,
                    start, adjacency, byWay, nodeGrid, components, main, coverage, direction, roadGrid)
            }

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
