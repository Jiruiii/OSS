package com.resilientgeo.mesh.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [EventEntity::class, ChunkEntity::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun chunkDao(): ChunkDao

    companion object {

        /**
         * v1 -> v2 adds the local chunk inventory ([ChunkEntity]).
         *
         * A real migration rather than `fallbackToDestructiveMigration()`:
         * dropping the database on upgrade would wipe the events a phone is
         * carrying, and "the data survives with no network" is this
         * project's phase-1 acceptance criterion. An upgrading device
         * simply starts with an empty inventory and repopulates it as
         * chunks arrive.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `chunks` (
                        `datasetId` TEXT NOT NULL,
                        `namespace` TEXT NOT NULL,
                        `chunkId` TEXT NOT NULL,
                        `manifestId` TEXT NOT NULL,
                        `datasetVersion` INTEGER NOT NULL,
                        `chunkHash` TEXT NOT NULL,
                        `sizeBytes` INTEGER NOT NULL,
                        `priority` TEXT NOT NULL,
                        `receivedAtEpochMillis` INTEGER NOT NULL,
                        PRIMARY KEY(`datasetId`, `namespace`, `chunkId`)
                    )
                    """.trimIndent(),
                )
            }
        }

        @Volatile
        private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "resilientgeo-mesh.db",
            ).addMigrations(MIGRATION_1_2).build().also { instance = it }
        }
    }
}
