plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
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

