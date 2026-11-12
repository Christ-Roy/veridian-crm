// Build autonome : le contrat se teste avec un JDK seul (CI sans SDK Android), et l'app l'inclut (includeBuild).
pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }
dependencyResolutionManagement { repositories { mavenCentral() } }
rootProject.name = "contrat"
