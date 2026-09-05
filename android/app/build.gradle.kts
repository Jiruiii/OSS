plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.resilientgeo.mesh"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.resilientgeo.mesh"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // minSdk 26 ships java.time natively, so unlike module B's original
        // standalone project (minSdk 24), no core library desugaring is
        // needed for the trust adapter's Instant-based timestamp parsing.
    }

    // No separate `kotlinOptions { jvmTarget = ... }` block: that DSL came
    // from the org.jetbrains.kotlin.android plugin, which this project
    // doesn't apply (see build.gradle.kts). Built-in Kotlin derives the
    // Kotlin compile target from compileOptions above instead — confirmed
    // by actually running ./gradlew here ("Unresolved reference
    // 'kotlinOptions'" once kotlin.android was removed).

    buildFeatures {
        // Views + ViewBinding for the offline-GIS screen (module B). Compose
        // was dropped: the only place it was used was the placeholder
        // "Hello Android" MainActivity this replaces — BleSpikeActivity
        // (module C's Stage 0 spike) was always a plain ComponentActivity
        // with no Compose UI. Re-add compose = true and the Compose BOM
        // dependencies if a future screen genuinely wants Compose.
        viewBinding = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(project(":flutter"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.material)
    implementation(libs.androidx.recyclerview)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.kotlinx.coroutines.android)

    // No Play Services dependency: ADR-001 rejected Nearby Connections
    // after both test devices got a Google-side INTERNAL_ERROR, and its
    // implementation has been removed. BLE GATT needs only the platform
    // Bluetooth APIs, which is also what lets this app work with no
    // Google services present at all.

    // Local database (module B): events, versions, expiry.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // Ed25519 verification adapter (module B): Android's own java.security
    // provider only gained EdDSA support in API 33, so the trust adapter
    // uses Bouncy Castle directly instead of relying on the platform
    // provider (see android/README.md).
    implementation(libs.bouncycastle.bcprov)

    testImplementation(libs.junit)
    // The stub org.json shipped in android.jar throws on every call under
    // plain JUnit; pull in the real implementation for the trust-adapter
    // and apply-rule unit tests, which don't need a device.
    testImplementation(libs.json.org)

    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.room.testing)
}
