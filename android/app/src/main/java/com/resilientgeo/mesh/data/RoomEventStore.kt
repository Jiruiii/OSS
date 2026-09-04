package com.resilientgeo.mesh.data

import com.resilientgeo.mesh.ingest.EventStore
import com.resilientgeo.mesh.ingest.StoredEvent

/** [EventStore] backed by Room/SQLite — the on-device counterpart of [com.resilientgeo.mesh.ingest.InMemoryEventStore]. */
class RoomEventStore(private val dao: EventDao) : EventStore {

    override fun find(namespace: String, eventId: String): StoredEvent? =
        dao.findSync(namespace, eventId)?.toStoredEvent()

    override fun findUnderOtherNamespace(eventId: String, excludingNamespace: String): StoredEvent? =
        dao.findUnderOtherNamespaceSync(eventId, excludingNamespace)?.toStoredEvent()

    override fun save(event: StoredEvent) {
        dao.upsertSync(event.toEntity())
    }

    override fun all(): List<StoredEvent> = dao.allSync().map { it.toStoredEvent() }
}
