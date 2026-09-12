package com.example.aoiro

import javafx.application.Application
import javafx.fxml.FXMLLoader
import javafx.scene.Scene
import javafx.stage.Stage

class MainApp : Application() {
    override fun start(primaryStage: Stage) {
        val loader = FXMLLoader(javaClass.getResource("/main_view.fxml"))
        val scene = Scene(loader.load(), 1000.0, 700.0)
        primaryStage.title = "青色申告 MVP (Kotlin + JavaFX)"
        primaryStage.scene = scene
        primaryStage.show()
    }
}

fun main(args: Array<String>) {
    Application.launch(MainApp::class.java, *args)
}
