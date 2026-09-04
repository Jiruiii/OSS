package com.resilientgeo.mesh.ingest

/** Reference [EventStore] used by unit tests; keeps parity with the `new Map()` store in the Node tests. */
class InMemoryEventStore : EventStore {
    private val byKey = LinkedHashMap<Pair<String, String>, StoredEvent>()

    override fun find(namespace: String, eventId: String): StoredEvent? = byKey[namespace to eventId]

    override fun findUnderOtherNamespace(eventId: String, excludingNamespace: String): StoredEvent? =
        byKey.values.firstOrNull { it.eventId == eventId && it.namespace != excludingNamespace }

    override fun save(event: StoredEvent) {
        byKey[event.namespace to event.eventId] = event
    }

    override fun all(): List<StoredEvent> = byKey.values.toList()
}
