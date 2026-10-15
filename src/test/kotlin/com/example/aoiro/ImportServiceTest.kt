package com.example.aoiro

import com.example.aoiro.model.ColumnSpec
import com.example.aoiro.service.ExcelImportService
import com.example.aoiro.service.ImportParserService
import com.example.aoiro.service.PluginConfigJson
import org.apache.poi.xssf.usermodel.XSSFWorkbook
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Path

class ImportServiceTest {

    @Test
    fun testParseAmount() {
        assertEquals(5000L, ImportParserService.parseAmount("¥5,000"))
        assertEquals(5000L, ImportParserService.parseAmount("5,000円"))
        assertEquals(0L, ImportParserService.parseAmount(""))
        assertEquals(123L, ImportParserService.parseAmount("-123"))
    }

    @Test
    fun testParseDate() {
        assertEquals("2025-01-15", ImportParserService.parseDate("20250115").toString())
        assertEquals("2025-01-15", ImportParserService.parseDate("2025/01/15").toString())
        assertEquals("2025-01-15", ImportParserService.parseDate("2025年01月15日").toString())
    }

    @Test
    fun testColumnSpecJoin() {
        val config = PluginConfigJson.parse(
            """
            {
              "id": "paypay-bank", "name": "PayPay銀行", "format": "csv", "encoding": "UTF-8",
              "supportedExtensions": ["csv"], "targetSheet": "PayPay銀行",
              "defaultDebitAccount": "普通預金", "defaultCreditAccount": "普通預金",
              "columns": {
                "date": {"index": [0,1,2], "join": "/"},
                "description": {"index": 7},
                "income": {"index": 9}, "expense": {"index": 8}, "balance": {"index": 10}
              }
            }
            """.trimIndent()
        )
        val dateSpec = config.columns!!.date
        assertTrue(dateSpec is ColumnSpec.Joined)
        val row = listOf("2025", "1", "15", "", "", "", "", "摘要", "100", "0", "1000")
        assertEquals("2025/1/15", ImportParserService.getColumnValue(row, dateSpec))
    }

    @Test
    fun testParseCsvBank(@TempDir tempDir: Path) {
        val csv = "日付,摘要,出金,入金,残高\n2025/01/15,テスト入金,0,5000,15000\n2025/01/16,テスト出金,2000,0,13000\n"
        val file = tempDir.resolve("bank.csv").toFile()
        file.writeText(csv, Charsets.UTF_8)
        val config = PluginConfigJson.parse(
            """
            {
              "id": "test-bank", "name": "テスト銀行", "format": "csv", "encoding": "UTF-8",
              "supportedExtensions": ["csv"], "delimiter": ",", "skipRows": 0, "hasHeader": true,
              "targetSheet": "テスト銀行",
              "defaultDebitAccount": "普通預金", "defaultDebitSubAccount": "テスト銀行",
              "defaultCreditAccount": "普通預金", "defaultCreditSubAccount": "テスト銀行",
              "columns": {
                "date": {"index": 0}, "description": {"index": 1},
                "expense": {"index": 2}, "income": {"index": 3}, "balance": {"index": 4}
              }
            }
            """.trimIndent()
        )
        val txs = ImportParserService.parseCsv(config, file)
        assertEquals(2, txs.size)
        assertEquals("入金", txs[0].category)
        assertEquals(5000L, txs[0].amount)
        assertEquals("出金", txs[1].category)
        val entries = ImportParserService.toJournalEntries(config, txs)
        assertEquals(2, entries.size)
    }

    @Test
    fun testParseTsvDirect() {
        val tsv = "2025/01/15\t\t\tテスト商品\t5000\t注文ID123"
        val txs = ImportParserService.parseTsvDirect(tsv)
        assertEquals(1, txs.size)
        assertEquals(5000L, txs[0].amount)
        assertEquals("テスト商品", txs[0].description)
    }

    @Test
    fun testParseText(@TempDir tempDir: Path) {
        val text = "注文日: 2025/01/15 商品: テスト商品 金額: ¥5,000\n注文日: 2025/01/16 商品: 別商品 金額: ¥2,000\n"
        val file = tempDir.resolve("orders.txt").toFile()
        file.writeText(text, Charsets.UTF_8)
        val config = PluginConfigJson.parse(
            """
            {
              "id": "test-text", "name": "テスト", "format": "text", "encoding": "UTF-8",
              "supportedExtensions": [".txt"], "targetSheet": "テスト",
              "defaultDebitAccount": "消耗品費", "defaultCreditAccount": "",
              "textPatterns": {
                "blockSeparator": "注文日:",
                "date": "注文日:\\s*(\\d{4}/\\d{2}/\\d{2})",
                "description": "商品:\\s*(.+?)\\s*金額:",
                "amount": "金額:\\s*[¥￥]?([\\d,]+)"
              }
            }
            """.trimIndent()
        )
        val txs = ImportParserService.parseText(config, file)
        assertEquals(2, txs.size)
        assertEquals("テスト商品", txs[0].description)
        assertEquals(5000L, txs[0].amount)
    }

    @Test
    fun testWriteTransactionsDedup(@TempDir tempDir: Path) {
        // 設定シート付きのExcelを作成
        val wb = XSSFWorkbook()
        val settings = wb.createSheet("設定")
        settings.createRow(0).createCell(0).setCellValue("対象年度")
        settings.getRow(0).createCell(1).setCellValue(2025.0)
        settings.createRow(1)
        val header = settings.createRow(2)
        header.createCell(0).setCellValue("シート名")
        header.createCell(1).setCellValue("勘定科目")
        header.createCell(5).setCellValue("繰越残高")
        val dataRow = settings.createRow(3)
        dataRow.createCell(0).setCellValue("テスト銀行")
        dataRow.createCell(1).setCellValue("普通預金")
        dataRow.createCell(5).setCellValue(10000.0)
        val excelFile = tempDir.resolve("test.xlsx").toFile()
        FileOutputStream(excelFile).use { wb.write(it) }
        wb.close()

        val config = PluginConfigJson.parse(
            """
            {
              "id": "test-bank", "name": "テスト銀行", "format": "csv", "encoding": "UTF-8",
              "supportedExtensions": ["csv"], "targetSheet": "テスト銀行",
              "defaultDebitAccount": "普通預金", "defaultCreditAccount": "普通預金",
              "columns": {
                "date": {"index": 0}, "description": {"index": 1},
                "expense": {"index": 2}, "income": {"index": 3}, "balance": {"index": 4}
              }
            }
            """.trimIndent()
        )
        val csv = "日付,摘要,出金,入金,残高\n2025/01/15,テスト入金,0,5000,15000\n"
        val csvFile = tempDir.resolve("bank.csv").toFile()
        csvFile.writeText(csv, Charsets.UTF_8)
        val txs = ImportParserService.parseCsv(config, csvFile)

        val count1 = ExcelImportService.writeTransactionsToSheet(
            excelFile, "テスト銀行", txs,
            layoutParam = com.example.aoiro.model.SheetLayout.BANK,
            hasOpeningBalance = true
        )
        assertEquals(1, count1)
        // 2回目は重複として0件
        val count2 = ExcelImportService.writeTransactionsToSheet(
            excelFile, "テスト銀行", txs,
            layoutParam = com.example.aoiro.model.SheetLayout.BANK,
            hasOpeningBalance = true
        )
        assertEquals(0, count2)

        // インポート対象の取得
        val targets = ExcelImportService.getImportTargets(excelFile)
        assertTrue(targets.any { it.sheetName == "テスト銀行" })
    }

    @Test
    fun testPreviewWithJson(@TempDir tempDir: Path) {
        val csv = "日付,摘要,出金,入金,残高\n2025/01/15,テスト入金,0,5000,15000\n"
        val csvFile = tempDir.resolve("bank.csv").toFile()
        csvFile.writeText(csv, Charsets.UTF_8)
        val json = """
        {
          "id": "test-bank", "name": "テスト銀行", "format": "csv", "encoding": "UTF-8",
          "supportedExtensions": ["csv"], "targetSheet": "テスト銀行",
          "defaultDebitAccount": "普通預金", "defaultCreditAccount": "普通預金",
          "columns": {
            "date": {"index": 0}, "description": {"index": 1},
            "expense": {"index": 2}, "income": {"index": 3}, "balance": {"index": 4}
          }
        }
        """.trimIndent()
        val (txs, entries) = ExcelImportService.previewWithJson(json, listOf(csvFile))
        assertEquals(1, txs.size)
        assertEquals(1, entries.size)
    }
}
