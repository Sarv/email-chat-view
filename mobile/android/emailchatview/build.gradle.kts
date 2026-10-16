plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    `maven-publish`
}

android {
    namespace = "com.sarv.emailchatview"
    compileSdk = 35

    defaultConfig {
        // The page needs a WebView with `color-mix()` (Chromium 111+). WebView
        // updates through the Play Store independently of the OS, so the floor
        // here is about the API surface, not the engine.
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    sourceSets["main"].apply {
        // The page is generated ONCE, by `pnpm build:mobile`, into the Swift
        // package (SwiftPM can only bundle what lives under its target). Read
        // from there, so iOS and Android can never ship different builds of it.
        assets.srcDir("../../ios/Sources/EmailChatView/Resources")
        java.srcDir("src/main/kotlin")
    }
    sourceSets["test"].java.srcDir("src/test/kotlin")

    // The one variant JitPack serves. Sources ride along so "go to definition"
    // in an app lands on Kotlin, not a decompiled class.
    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub that throws in local unit tests; the
    // real implementation stands in for it there.
    testImplementation("org.json:json:20240303")
}

// Published by JitPack from a version tag (see jitpack.yml at the repo root),
// as `com.github.Sarv:email-chat-view:<tag>`. The version is the tag JitPack
// is building, passed in as `releaseVersion`, so there is no Android version
// number to keep in step with package.json — the tag already is one.
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.github.Sarv"
            artifactId = "email-chat-view"
            version = providers.gradleProperty("releaseVersion").getOrElse("dev")
            afterEvaluate { from(components["release"]) }
        }
    }
}
