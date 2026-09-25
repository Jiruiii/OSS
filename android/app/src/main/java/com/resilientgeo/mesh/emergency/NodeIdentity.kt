package com.resilientgeo.mesh.emergency

import android.content.Context
import java.util.UUID

/**
 * A stable per-install `node_id` for this device's own HELLO.
 *
 * The Peer Sync demo hardcoded "node-a"/"node-b" because a human picked the
 * role on screen; automatic sync has no such moment, so every device needs
 * an identity of its own before it can advertise a `peer-summary-v0`.
 * Generated once and persisted — a value that changed across restarts would
 * make a peer's "have I already synced with this node" bookkeeping useless.
 */
class NodeIdentity(context: Context) {
    private val preferences = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    val nodeId: String
        get() = preferences.getString(KEY_NODE_ID, null) ?: generateAndStore()

    private fun generateAndStore(): String {
        val generated = "node-" + UUID.randomUUID().toString()
        preferences.edit().putString(KEY_NODE_ID, generated).apply()
        return generated
    }

    private companion object {
        const val PREFERENCES_NAME = "node_identity"
        const val KEY_NODE_ID = "node_id"
    }
}
