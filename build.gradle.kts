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
    implementation("org.apache.poi:poi-ooxml:5.2.5")
    // データインポート機能用（legacy React アプリの移植）
    implementation("org.jsoup:jsoup:1.15.3")
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

application {
    mainClass.set("com.example.aoiro.MainAppKt")
}
