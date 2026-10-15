package com.example.aoiro

import com.example.aoiro.service.ExcelLoader
import com.example.aoiro.service.LedgerService
import org.junit.jupiter.api.Test
import java.io.File

class LedgerServiceTest {
    @Test
    fun testGenerateLedgers() {
        val file = File("2025青色申告.xlsx")
        if (!file.exists()) {
            println("Skipping test: File not found")
            return
        }

        val entries = ExcelLoader.loadJournalEntries(file)
        val ledgers = LedgerService.generateLedgers(entries)

        println("=== LEDGER SERVICE TEST RESULT ===")
        println("Total Ledger Accounts: ${ledgers.size}")

        for (l in ledgers.take(10)) {
            println("Account: ${l.displayName} | Entries: ${l.entries.size} | ClosingBal: ${l.closingBalance}")
        }
    }
}
