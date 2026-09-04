// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    // org.jetbrains.kotlin.android is intentionally NOT applied: this AGP
    // version has "built-in Kotlin" (com.android.application registers
    // Kotlin support itself), and explicitly re-applying kotlin.android
    // on top of it crashes with "Cannot add extension with name 'kotlin',
    // as there is an extension already registered with that name."
    // kapt is explicitly incompatible with built-in Kotlin ("The
    // 'org.jetbrains.kotlin.kapt' plugin is not compatible with built-in
    // Kotlin support" — AGP's own error message); KSP is the supported
    // annotation-processing path instead. Both confirmed by actually
    // running ./gradlew against this project.
    alias(libs.plugins.ksp) apply false
}
