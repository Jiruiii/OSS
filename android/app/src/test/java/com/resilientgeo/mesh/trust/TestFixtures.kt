package com.resilientgeo.mesh.trust

import org.json.JSONArray
import org.json.JSONObject

/** Loads the real Ed25519-signed fixtures under src/test/resources (same bytes shipped in app assets). */
object TestFixtures {
    private fun readResource(path: String): String =
        checkNotNull(TestFixtures::class.java.classLoader?.getResourceAsStream(path)) { "missing test resource: $path" }
            .bufferedReader()
            .use { it.readText() }

    fun signedEvents(): JSONArray = JSONObject(readResource("fixtures/signed-events.json")).getJSONArray("events")

    fun trustedKeyStore(): TrustedKeyStore = TrustedKeyStore.fromJson(readResource("trust/trusted-keys.json"))

    fun event(namespace: String, eventId: String, version: Int): JSONObject {
        val events = signedEvents()
        for (i in 0 until events.length()) {
            val event = events.getJSONObject(i)
            if (event.getString("namespace") == namespace && event.getString("event_id") == eventId && event.getInt("event_version") == version) {
                return event
            }
        }
        error("fixture event not found: $namespace/$eventId@$version")
    }
}
