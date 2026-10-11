plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val prodBaseUrl = (project.findProperty("YASHWIN_PROD_BASE_URL") as String?)
    ?: "https://ais-pre-tuksbxdpaeqeyjl35z77of-346280624125.asia-southeast1.run.app"
val emulatorDevUrl = (project.findProperty("YASHWIN_EMULATOR_DEV_URL") as String?)
    ?: "http://10.0.2.2:3000"

android {
    namespace = "com.yashwin.aitrading"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.yashwin.aitrading"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // Strictly PAPER MODE ONLY — zero live broker execution or secrets in BuildConfig
        buildConfigField("String", "TRADING_MODE", "\"paper\"")
        buildConfigField("boolean", "LIVE_TRADING_ENABLED", "false")
        buildConfigField("String", "PROD_BASE_URL", "\"$prodBaseUrl\"")
        buildConfigField("String", "EMULATOR_DEV_URL", "\"$emulatorDevUrl\"")
    }

    signingConfigs {
        // Debug builds use the standard Android debug keystore automatically.
        // Release signing reads strictly from external environment variables — never commit keystores or passwords.
        create("releaseExternal") {
            val keystorePath = System.getenv("YASHWIN_RELEASE_STORE_FILE")
            if (!keystorePath.isNullOrBlank() && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("YASHWIN_RELEASE_STORE_PASSWORD")
                keyAlias = System.getenv("YASHWIN_RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("YASHWIN_RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            // Note: On a physical Android device, "localhost" (127.0.0.1) refers to the device itself.
            // Use the HTTPS deployed URL by default, or override via -PYASHWIN_BACKEND_URL for LAN/emulator testing.
            val debugBackendUrl = (project.findProperty("YASHWIN_BACKEND_URL") as String?) ?: prodBaseUrl
            buildConfigField("String", "BACKEND_BASE_URL", "\"$debugBackendUrl\"")
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            buildConfigField("String", "BACKEND_BASE_URL", "\"$prodBaseUrl\"")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSign = signingConfigs.findByName("releaseExternal")
            if (releaseSign?.storeFile != null) {
                signingConfig = releaseSign
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
}
