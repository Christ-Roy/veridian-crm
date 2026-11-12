import java.util.Properties

plugins {
    id("com.android.application")
    kotlin("android")
}

// Signature : clé hors dépôt (bastion), désignée par TELEPHONIE_SIGNATURE=<fichier .properties>
// (storeFile, storePassword, keyAlias, keyPassword). Sans elle, l'APK de release n'est pas signé.
val signature = System.getenv("TELEPHONIE_SIGNATURE")?.let { f -> Properties().apply { file(f).inputStream().use { load(it) } } }

android {
    namespace = "site.veridian.telephonie"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "site.veridian.telephonie"
        minSdk = 31
        targetSdk = 36
        versionCode = (System.getenv("TELEPHONIE_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("TELEPHONIE_VERSION") ?: "dev"
        // arm64 : les téléphones ; x86_64 : l'émulateur de recette (KVM). Parakeet compilé pour les deux.
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DWHISPER_DIR=${rootDir}/build-deps/whisper.cpp", "-DANDROID_STL=c++_static",
                    "-DCMAKE_BUILD_TYPE=Release")
            }
        }
    }

    signingConfigs {
        if (signature != null) create("release") {
            storeFile = file(signature.getProperty("storeFile"))
            storePassword = signature.getProperty("storePassword")
            keyAlias = signature.getProperty("keyAlias")
            keyPassword = signature.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signature != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

dependencies {
    implementation("site.veridian.telephonie:contrat:1")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    // Lecture du QR de connexion (Apache 2.0, sans Google Play Services) ; caméra demandée seulement au scan.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
