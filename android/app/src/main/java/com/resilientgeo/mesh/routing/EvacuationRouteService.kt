package com.resilientgeo.mesh.routing

import android.content.Context
import com.resilientgeo.mesh.ingest.ApplyState
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.temporal.ChronoUnit

data class RouteRequest(
    val origin: LonLat,
    val destinationId: String,
    val destination: LonLat,
    val mode: String,
)

/**
 * Answers `calculateEvacuationRoute` entirely offline: the bundled walk graph,
 * the verified events already in Room, and nothing else. No routing API is
 * ever called.
 *
 * The graph is loaded once; the hazard overlay is rebuilt only when the event
 * snapshot changes, because Flutter asks for up to five shelters in a row when
 * it recommends the nearest reachable one.
 */
class EvacuationRouteService(
    private val graphLoader: () -> RoadGraph,
    private val eventJsonProvider: suspend () -> List<String>,
    private val clock: () -> Instant = Instant::now,
) {
    private val mutex = Mutex()
    private var graph: RoadGraph? = null
    private var cachedOverlay: Pair<String, HazardOverlay>? = null

    suspend fun calculate(request: RouteRequest): RouteResult = mutex.withLock {
        val now = clock()
        val events = eventJsonProvider().mapNotNull { RouteEvent.fromEventJson(it, now) }
        val snapshotAt = snapshotTime(events, now)
        if (!request.origin.isValid || !request.destination.isValid ||
            request.destinationId.isBlank() || request.mode != "walk"
        ) {
            return@withLock RouteResult.failure(RouteStatus.INVALID_INPUT, snapshotAt)
        }
        val loaded = graph ?: try {
            graphLoader().also { graph = it }
        } catch (_: Exception) {
            return@withLock RouteResult.failure(RouteStatus.GRAPH_UNAVAILABLE, snapshotAt)
        }
        val fingerprint = events.map { "${it.identity}:${it.applyState}" }.sorted().joinToString("|")
        val overlay = cachedOverlay?.takeIf { it.first == fingerprint }?.second
            ?: HazardOverlay.fromEvents(events, loaded).also { cachedOverlay = fingerprint to it }
        EvacuationRouter.plan(
            graph = loaded,
            overlay = overlay,
            origin = request.origin,
            destination = request.destination,
            shelter = ShelterState.resolve(request.destination, events),
            snapshotAt = snapshotAt,
        )
    }

    companion object {
        const val GRAPH_ASSET = "routing/walk-roads.json"

        fun assetGraphLoader(context: Context): () -> RoadGraph = {
            val text = context.applicationContext.assets.open(GRAPH_ASSET).bufferedReader().use { it.readText() }
            RoadGraph.fromWalkRoadsJson(text)
        }

        /** Newest issue time among events still in force; the planning time if there are none. */
        internal fun snapshotTime(events: List<RouteEvent>, now: Instant): String {
            val newest = events
                .filter { it.applyState != ApplyState.EXPIRED }
                .mapNotNull { event -> event.issuedAt?.let { runCatching { Instant.parse(it) }.getOrNull() } }
                .filter { !it.isAfter(now) }
                .maxOrNull()
                ?: now
            return newest.truncatedTo(ChronoUnit.SECONDS).toString()
        }
    }
}
