package com.example.aoiro

import com.example.aoiro.service.ExcelLoader
import org.junit.jupiter.api.Test
import java.io.File

class ExcelLoaderTest {
    @Test
    fun testExcelLoad() {
        val file = File("2025青色申告.xlsx")
        if (file.exists()) {
            val entries = ExcelLoader.loadJournalEntries(file)
            println("=== TEST RESULT ===")
            println("Total entries parsed: ${entries.size}")
            val counts = entries.groupBy { it.sourceSheet }.mapValues { it.value.size }
            println("Kotlin Breakdown: $counts")
        } else {
            println("File not found: ${file.absolutePath}")
        }
    }
}
