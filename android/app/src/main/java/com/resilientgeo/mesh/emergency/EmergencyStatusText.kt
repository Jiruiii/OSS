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
     * e.g. `contentText(5)` -> "Background sync standby — alive 5s",
     * `contentText(65)` -> "Background sync standby — alive 1m 05s".
     */
    fun contentText(aliveSeconds: Long): String {
        require(aliveSeconds >= 0) { "aliveSeconds must not be negative: $aliveSeconds" }
        val minutes = aliveSeconds / 60
        val seconds = aliveSeconds % 60
        val elapsed = if (minutes > 0) "${minutes}m %02ds".format(seconds) else "${seconds}s"
        return "Background sync standby — alive $elapsed"
    }
}
