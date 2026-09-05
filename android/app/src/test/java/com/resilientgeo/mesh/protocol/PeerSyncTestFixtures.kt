package com.resilientgeo.mesh.protocol

import org.json.JSONObject

/** Loads the peer-sync fixtures under src/test/resources/fixtures/peer-sync (same bytes as repo root /fixtures). */
object PeerSyncTestFixtures {
    private fun readResource(path: String): String =
        checkNotNull(PeerSyncTestFixtures::class.java.classLoader?.getResourceAsStream(path)) {
            "missing test resource: $path"
        }.bufferedReader().use { it.readText() }

    fun peerSummary(fileName: String): PeerSummary =
        PeerSummary.fromJson(JSONObject(readResource("fixtures/peer-sync/$fileName")))

    fun exchange(): JSONObject = JSONObject(readResource("fixtures/peer-sync/protocol-exchange-v0.json"))
}
