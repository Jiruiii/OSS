import java.io.File
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
}

val splashResDir = layout.buildDirectory.dir("generated/res/splash/main")
val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")

if (localPropertiesFile.isFile) {
    localPropertiesFile.inputStream().use(localProperties::load)
}

fun readDotEnv(file: File): Properties {
    val properties = Properties()
    if (!file.isFile) return properties

    file.forEachLine { rawLine ->
        val line = rawLine.trim()
        if (line.isEmpty() || line.startsWith("#")) return@forEachLine
        val assignment = line.removePrefix("export ").trim()
        val separator = assignment.indexOf('=')
        if (separator <= 0) return@forEachLine

        val name = assignment.substring(0, separator).trim()
        var value = assignment.substring(separator + 1).trim()
        if (value.length >= 2 &&
            value.first() == value.last() &&
            (value.first() == '\'' || value.first() == '"')
        ) {
            value = value.substring(1, value.length - 1)
        }
        properties.setProperty(name, value)
    }
    return properties
}

// The repository-root .env is ignored by git and is convenient for Android
// Studio users. Never print these values or copy them into Flutter assets.
val dotEnv = readDotEnv(rootProject.file("../.env"))

// A shell/CI environment value wins over the ignored developer-local file.
// Empty is intentional: the Flutter renderer detects it and keeps the OSM
// asset map available when a Google Maps key has not been configured yet.
val googleMapsApiKey = System.getenv("GOOGLE_MAPS_API_KEY")
    ?.trim()
    .takeUnless { it.isNullOrEmpty() }
    ?: localProperties.getProperty("GOOGLE_MAPS_API_KEY")?.trim().orEmpty()
        .takeUnless { it.isEmpty() }
    ?: dotEnv.getProperty("GOOGLE_MAPS_API_KEY")?.trim().orEmpty()

android {
    namespace = "com.resilientgeo.mesh"
    // AGP 8.7.3 (the Flutter 3.29.2 plugin baseline) is tested through API
    // 35 on this checkout; targetSdk can remain newer independently.
    compileSdk = 35

    defaultConfig {
        applicationId = "com.resilientgeo.mesh"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        manifestPlaceholders["GOOGLE_MAPS_API_KEY"] = googleMapsApiKey

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // minSdk 26 ships java.time natively, so unlike module B's original
        // standalone project (minSdk 24), no core library desugaring is
        // needed for the trust adapter's Instant-based timestamp parsing.
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    buildFeatures {
        // Views + ViewBinding for the native support screens (module B). Compose
        // was dropped: the only place it was used was the placeholder
        // "Hello Android" MainActivity this replaces — BleSpikeActivity
        // (module C's Stage 0 spike) was always a plain ComponentActivity
        // with no Compose UI. Re-add compose = true and the Compose BOM
        // dependencies if a future screen genuinely wants Compose.
        viewBinding = true
    }

    sourceSets["main"].res.srcDir(splashResDir)

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
    implementation(libs.androidx.core.splashscreen)
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

val copySplashLogo = tasks.register<Copy>("copySplashLogo") {
    from(project.file("../../flutter/assets/Logo.png"))
    into(splashResDir.map { it.dir("drawable-nodpi") })
    rename { "resilientgeo_logo.png" }
}

tasks.named("preBuild").configure {
    dependsOn(copySplashLogo)
}
