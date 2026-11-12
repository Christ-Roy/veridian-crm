plugins { kotlin("jvm") version "2.1.21" }

group = "site.veridian.telephonie"
version = "1"

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

tasks.test { testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL } }
