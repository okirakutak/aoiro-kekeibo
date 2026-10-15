package com.example.aoiro

import com.example.aoiro.service.ExcelLoader
import com.example.aoiro.service.FinancialReportService
import com.example.aoiro.service.LedgerService
import org.junit.jupiter.api.Test
import java.io.File

class FinancialReportServiceTest {
    @Test
    fun testFinancialReports() {
        val file = File("2025青色申告.xlsx")
        if (!file.exists()) {
            println("Skipping test: File not found")
            return
        }

        val entries = ExcelLoader.loadJournalEntries(file)
        val ledgers = LedgerService.generateLedgers(entries)

        val pl = FinancialReportService.generatePL(ledgers)
        val bs = FinancialReportService.generateBS(ledgers, pl.netIncome)

        println("=== KOTLIN LEDGERS ===")
        for (l in ledgers) {
            val key = if (l.subAccountName != null) "${l.accountName}::${l.subAccountName}" else l.accountName
            println("$key: open=${l.openingBalance}, debit=${l.totalDebit}, credit=${l.totalCredit}, closing=${l.closingBalance}")
        }

        println("=== KOTLIN PL ===")
        println("totalExpense: ${pl.totalExpense}, totalRevenue: ${pl.totalRevenue}, netIncome: ${pl.netIncome}")

        println("=== KOTLIN BS ===")
        println("totalAssets: ${bs.totalAssets}, totalLiabilities: ${bs.totalLiabilities}, netIncome: ${bs.netIncome}")
    }
}
