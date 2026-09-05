package com.resilientgeo.mesh.emergency

/**
 * Pure formatting logic for EmergencyModeService's notification, split out
 * so it can be unit tested on the JVM without starting a real Service —
 * `Notification`/`NotificationCompat` require an Android runtime, but the
 * text that goes into them doesn't need to.
 */
object EmergencyStatusText {

    fun title(): String = "Emergency Mode active"

    /**
     * Status line for the ongoing notification.
     *
     * The wording distinguishes three genuinely different states, because a
     * user in a disaster needs to be able to tell them apart at a glance:
     * discovery is off entirely (no Bluetooth or no permission), discovery
     * is running but nobody is nearby, or peers are actually visible.
     * Reporting "standby" in all three would hide the one case the user can
     * fix — turning Bluetooth on.
     *
     * e.g. `contentText(5, 0, true)` -> "Scanning for peers — none nearby · alive 5s",
     * `contentText(65, 2, true)` -> "2 peers nearby · alive 1m 05s".
     */
    fun contentText(aliveSeconds: Long, peers: Int = 0, discoveryActive: Boolean = true): String {
        require(aliveSeconds >= 0) { "aliveSeconds must not be negative: $aliveSeconds" }
        require(peers >= 0) { "peers must not be negative: $peers" }

        val minutes = aliveSeconds / 60
        val seconds = aliveSeconds % 60
        val elapsed = if (minutes > 0) "${minutes}m %02ds".format(seconds) else "${seconds}s"

        val status = when {
            !discoveryActive -> "Discovery off — check Bluetooth"
            peers == 0 -> "Scanning for peers — none nearby"
            peers == 1 -> "1 peer nearby"
            else -> "$peers peers nearby"
        }
        return "$status · alive $elapsed"
    }
}
