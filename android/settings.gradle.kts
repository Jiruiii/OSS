pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
dependencyResolutionManagement {
    // Flutter's Gradle plugin adds the engine Maven repository to the
    // generated :flutter project. Allow that plugin-owned repository while
    // retaining the settings repositories for the native host.
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ResilientGeoMesh"
include(":app")

// Flutter's generated include script owns the :flutter source-code
// subproject and its plugin loader. Do not edit flutter/.android manually.
apply(from = file("../flutter/.android/include_flutter.groovy"))
