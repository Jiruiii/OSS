package com.resilientgeo.mesh.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {

    // Synchronous lookups back the EventStore used by EventIngestor's apply
    // rules; callers are expected to run them off the main thread (the
    // ingest path already runs inside a coroutine on Dispatchers.IO).
    @Query("SELECT * FROM events WHERE namespace = :namespace AND eventId = :eventId LIMIT 1")
    fun findSync(namespace: String, eventId: String): EventEntity?

    @Query("SELECT * FROM events WHERE eventId = :eventId AND namespace != :excludingNamespace LIMIT 1")
    fun findUnderOtherNamespaceSync(eventId: String, excludingNamespace: String): EventEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertSync(entity: EventEntity)

    @Query("SELECT * FROM events ORDER BY namespace, eventId")
    fun allSync(): List<EventEntity>

    /** Drives the event-list / map UI so it updates live as ingestion writes new rows. */
    @Query("SELECT * FROM events ORDER BY namespace, eventId")
    fun observeAll(): Flow<List<EventEntity>>
}
