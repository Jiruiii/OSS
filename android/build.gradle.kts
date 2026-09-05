// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    // KSP is used for Room annotation processing. The Flutter module is
    // built by Flutter's own Gradle plugin and does not share this plugin
    // declaration.
    alias(libs.plugins.ksp) apply false
}
