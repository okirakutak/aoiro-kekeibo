plugins {
    kotlin("jvm") version "1.9.22"
    id("org.openjfx.javafxplugin") version "0.1.0"
    application
}

group = "com.example"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}

javafx {
    version = "21.0.2"
    modules = listOf("javafx.controls", "javafx.fxml")
}

dependencies {
    implementation(kotlin("stdlib"))
}

application {
    mainClass.set("com.example.aoiro.MainAppKt")
}
