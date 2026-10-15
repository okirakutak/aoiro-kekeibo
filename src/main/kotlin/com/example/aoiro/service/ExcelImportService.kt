package com.example.aoiro.service

import com.example.aoiro.model.*
import org.apache.poi.ss.usermodel.*
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.time.LocalDate
import java.time.ZoneId
import java.util.Date

// Excelを開く際は FileInputStream 経由でメモリに読み込む。
// WorkbookFactory.create(File) のまま同一ファイルへ FileOutputStream で書き戻すと
// パッケージの読み取りハンドルと書き込みが競合し ZIP 破損を起こすため。
private fun openWorkbook(excelFile: File): Workbook {
    val input = FileInputStream(excelFile)
    return try {
        WorkbookFactory.create(input)
    } finally {
        try {
            input.close()
        } catch (e: Exception) {
            // 無視
        }
    }
}

// Excel転記・設定シート連携サービス
// legacy の excel.service.ts（getImportTargets / loadPluginConfigsFromExcel / savePluginConfig）
// および excel-writer.service.ts（writeTransactionsToSheet）の Kotlin 移植
object ExcelImportService {

    data class SheetColumns(
        val dateCol: Int = 0,
        val accountCol: Int = 1,
        val subAccountCol: Int = 2,
        val descCol: Int = 3,
        val amountCol: Int = 4,
        val incomeCol: Int = 4,
        val expenseCol: Int = 5,
        val balanceCol: Int = 6,
        val memoCol: Int = -1,
        val isSplitFormat: Boolean = false
    )

    data class ExistingRow(
        val ymd: String,
        val description: String,
        val income: Long,
        val expense: Long
    )

    data class ExtractResult(
        val combinedText: String,
        val filePaths: List<File>
    )

    // 設定シートのヘッダー行（0-based index 2 = 3行目）から列位置を検出する
    private data class SettingsCols(
        val settleCol: Int = 3,
        val settleSubCol: Int = 4,
        val keywordCol: Int = 5,
        val cutoffCol: Int = -1,
        val payMonthCol: Int = -1,
        val payDayCol: Int = -1,
        val jsonCol: Int = 6
    )

    private fun detectSettingsCols(settingsSheet: Sheet): SettingsCols {
        var settleCol = 3
        var settleSubCol = 4
        var keywordCol = 5
        var cutoffCol = -1
        var payMonthCol = -1
        var payDayCol = -1
        var jsonCol = 6
        val headerRow = settingsSheet.getRow(2) ?: return SettingsCols()
        for (c in 0 until (headerRow.lastCellNum.toInt())) {
            val text = getCellString(headerRow.getCell(c)).trim()
            if (text.contains("決済先科目") || text == "決済先") settleCol = c
            if (text.contains("決済先補助")) settleSubCol = c
            if (text.contains("キーワード") || text.contains("検索")) keywordCol = c
            if (text.contains("締")) cutoffCol = c
            if (text.contains("支払月") || text.contains("引き落とし月") || text.contains("決済月")) payMonthCol = c
            if (text.contains("支払日") || text.contains("引き落とし日") || text.contains("決済日")) payDayCol = c
            if (text.contains("JSON") || text.contains("設定")) jsonCol = c
        }
        return SettingsCols(settleCol, settleSubCol, keywordCol, cutoffCol, payMonthCol, payDayCol, jsonCol)
    }

    private fun parseCutoffDay(raw: String): Any? {
        val txt = raw.trim()
        if (txt.isEmpty()) return null
        if (txt.contains("末") || txt.lowercase() == "last" || txt == "31") return "last"
        val num = txt.filter { it.isDigit() }.toIntOrNull()
        if (num != null && num in 1..31) return num
        return null
    }

    private fun parsePaymentMonthOffset(raw: String): Int? {
        val txt = raw.trim()
        if (txt.isEmpty()) return null
        if (txt.contains("翌々") || txt == "2") return 2
        if (txt.contains("翌") || txt == "1") return 1
        if (txt.contains("当") || txt == "0") return 0
        return null
    }

    private fun parsePaymentDay(raw: String): Any? = parseCutoffDay(raw)

    private fun fallbackType(sheetName: String, id: String, name: String): String {
        val lowerId = id.lowercase()
        val lowerName = name.lowercase()
        val lowerSheet = sheetName.lowercase()
        return if (lowerId.contains("card") || lowerName.contains("カード") || lowerSheet.contains("カード") ||
            lowerName.contains("card") || sheetName.contains("カード")
        ) {
            "credit-card"
        } else if (lowerId.contains("bank") || lowerName.contains("銀行") || lowerSheet.contains("銀行") ||
            sheetName.contains("銀行")
        ) {
            "bank"
        } else {
            "shopping"
        }
    }

    // インポート対象シート一覧を取得する（getImportTargets に対応）
    fun getImportTargets(excelFile: File): List<ImportTargetSheet> {
        openWorkbook(excelFile).use { workbook ->
            val settingsSheet = workbook.getSheet("設定") ?: return emptyList()
            val sc = detectSettingsCols(settingsSheet)
            val targets = mutableListOf<ImportTargetSheet>()
            for (r in 3..settingsSheet.lastRowNum) {
                val row = settingsSheet.getRow(r) ?: continue
                val sheetName = getCellString(row.getCell(0)).trim()
                val account = getCellString(row.getCell(1)).trim()
                val subAccount = getCellString(row.getCell(2)).trim().ifEmpty { null }
                val settleSheet = row.getCell(sc.settleCol)?.let { getCellString(it).trim() }?.ifEmpty { null }
                val settleSub = row.getCell(sc.settleSubCol)?.let { getCellString(it).trim() }?.ifEmpty { null }
                val keyword = row.getCell(sc.keywordCol)?.let { getCellString(it).trim() }?.ifEmpty { null }
                val rawKeywords = listOfNotNull(settleSub, keyword).joinToString(" ")
                val searchKeywords = if (rawKeywords.isNotEmpty()) {
                    rawKeywords.split(Regex("[,、\\s]+")).filter { it.isNotEmpty() }
                } else null
                if (sheetName.isEmpty() || sheetName == "仕訳帳") continue
                // JSON設定のパース
                val jsonStr = row.getCell(sc.jsonCol)?.let { getCellString(it).trim() } ?: ""
                var hasJson = false
                var jsonConfig: PluginConfig? = null
                if ((jsonStr.startsWith("{") || jsonStr.startsWith("["))) {
                    try {
                        var parsed = PluginConfigJson.parse(jsonStr)
                        if (parsed.type == null) {
                            parsed = parsed.copy(type = fallbackType(sheetName, parsed.id, parsed.name))
                        }
                        if (sc.cutoffCol >= 0) {
                            val c = parseCutoffDay(getCellString(row.getCell(sc.cutoffCol)))
                            if (c != null) parsed = parsed.copy(cutoffDay = c)
                        }
                        if (sc.payMonthCol >= 0) {
                            val pm = getCellString(row.getCell(sc.payMonthCol)).let { parsePaymentMonthOffset(it) }
                            if (pm != null) parsed = parsed.copy(paymentMonthOffset = pm)
                        }
                        if (sc.payDayCol >= 0) {
                            val pd = getCellString(row.getCell(sc.payDayCol)).let { parsePaymentDay(it) }
                            if (pd != null) parsed = parsed.copy(paymentDay = pd)
                        }
                        jsonConfig = parsed
                        hasJson = true
                    } catch (e: Exception) {
                        // 不正JSONは無視（legacy と同様にログ相当でスキップ）
                    }
                }
                if (jsonConfig == null) {
                    jsonConfig = PluginConfig(
                        id = sheetName, name = sheetName, targetSheet = sheetName,
                        type = if (sheetName.contains("カード")) "credit-card" else if (sheetName.contains("銀行")) "bank" else "shopping"
                    )
                }
                targets.add(
                    ImportTargetSheet(
                        sheetName = sheetName, account = account, subAccount = subAccount,
                        settleSheet = settleSheet, settleSub = settleSub, keyword = keyword,
                        searchKeywords = searchKeywords, hasJson = hasJson, jsonConfig = jsonConfig
                    )
                )
            }
            return targets
        }
    }

    // Excelの「設定」シートからJSON設定を読み込む（loadPluginConfigsFromExcel に対応）
    fun loadPluginConfigsFromExcel(excelFile: File): List<PluginConfig> {
        openWorkbook(excelFile).use { workbook ->
            val settingsSheet = workbook.getSheet("設定") ?: return emptyList()
            val sc = detectSettingsCols(settingsSheet)
            val configs = mutableListOf<PluginConfig>()
            for (r in 3..settingsSheet.lastRowNum) {
                val row = settingsSheet.getRow(r) ?: continue
                var cutoffDay: Any? = null
                if (sc.cutoffCol >= 0) cutoffDay = parseCutoffDay(getCellString(row.getCell(sc.cutoffCol)))
                var paymentMonthOffset: Int? = null
                if (sc.payMonthCol >= 0) paymentMonthOffset = parsePaymentMonthOffset(getCellString(row.getCell(sc.payMonthCol)))
                var paymentDay: Any? = null
                if (sc.payDayCol >= 0) paymentDay = parsePaymentDay(getCellString(row.getCell(sc.payDayCol)))
                val jsonStr = getCellString(row.getCell(sc.jsonCol)).trim()
                if (jsonStr.isNotEmpty() && (jsonStr.startsWith("{") || jsonStr.startsWith("["))) {
                    try {
                        val parsed = PluginConfigJson.parse(jsonStr)
                        var item = parsed
                        if (cutoffDay != null) item = item.copy(cutoffDay = cutoffDay)
                        if (paymentMonthOffset != null) item = item.copy(paymentMonthOffset = paymentMonthOffset)
                        if (paymentDay != null) item = item.copy(paymentDay = paymentDay)
                        if (item.type == null) {
                            item = item.copy(type = fallbackType(item.targetSheet, item.id, item.name))
                        }
                        configs.add(item)
                    } catch (e: Exception) {
                        // 不正JSONはスキップ
                    }
                }
            }
            return configs
        }
    }

    // 設定シートにプラグイン設定JSONを保存する（savePluginConfig に対応）
    fun savePluginConfig(excelFile: File, sheetName: String, jsonStr: String): Boolean {
        // JSON形式チェック
        PluginConfigJson.parse(jsonStr)
        val workbook = openWorkbook(excelFile)
        try {
            val settingsSheet = workbook.getSheet("設定") ?: throw IllegalArgumentException("設定シートが見つかりません")
            var jsonCol = -1
            val headerRow = settingsSheet.getRow(2)
            if (headerRow != null) {
                for (c in 0 until headerRow.lastCellNum.toInt()) {
                    val text = getCellString(headerRow.getCell(c)).trim()
                    if (text.contains("JSON") || text.contains("設定")) jsonCol = c
                }
            }
            if (jsonCol < 0) jsonCol = 9 // 見つからない場合はJ列相当（0-based 9）
            var updated = false
            for (r in 3..settingsSheet.lastRowNum) {
                val row = settingsSheet.getRow(r) ?: continue
                val name = getCellString(row.getCell(0)).trim()
                if (name == sheetName) {
                    var cell = row.getCell(jsonCol)
                    if (cell == null) cell = row.createCell(jsonCol)
                    cell.setCellValue(jsonStr)
                    updated = true
                }
            }
            if (updated) {
                FileOutputStream(excelFile).use { out -> workbook.write(out) }
            }
            return updated
        } finally {
            workbook.close()
        }
    }

    // ヘッダー行をスキャンして列インデックスを検出する（detectSheetColumns に対応）
    fun detectSheetColumns(sheet: Sheet): SheetColumns {
        var dateCol = 0
        var accountCol = 1
        var subAccountCol = 2
        var descCol = 3
        var incomeCol = 4
        var expenseCol = 5
        var balanceCol = 6
        var memoCol = -1
        var foundExpense = false
        val headerRow = sheet.getRow(0)
        if (headerRow != null) {
            var fDate = -1
            var fAccount = -1
            var fSub = -1
            var fDesc = -1
            var fInc = -1
            var fExp = -1
            var fBal = -1
            var fMemo = -1
            for (c in 0 until headerRow.lastCellNum.toInt()) {
                val text = getCellString(headerRow.getCell(c)).trim()
                if (text == "日付") fDate = c
                if (text == "勘定科目" || text == "相手科目" || (text.contains("科目") && !text.contains("補助"))) fAccount = c
                if (text.contains("補助")) fSub = c
                if (text == "摘要" || text == "項目名") fDesc = c
                if (listOf("入金", "入金額", "お預り金額", "収入", "収入金額", "金額", "お支払金額", "支払金額").contains(text)) fInc = c
                if (listOf("支払", "出金額", "出金", "支出", "支出金額", "払出金額").contains(text)) {
                    fExp = c
                    foundExpense = true
                }
                if (text == "残高") fBal = c
                if (text == "備考") fMemo = c
            }
            if (fDate >= 0) dateCol = fDate
            if (fAccount >= 0) accountCol = fAccount
            if (fSub >= 0) subAccountCol = fSub
            if (fDesc >= 0) descCol = fDesc
            if (fInc >= 0) incomeCol = fInc
            if (fExp >= 0) expenseCol = fExp
            if (fBal >= 0) balanceCol = fBal
            if (fMemo >= 0) memoCol = fMemo
        }
        val isSplitFormat = foundExpense && incomeCol != expenseCol
        return SheetColumns(dateCol, accountCol, subAccountCol, descCol, incomeCol, incomeCol, expenseCol, balanceCol, memoCol, isSplitFormat)
            .copy(amountCol = incomeCol)
    }

    private fun excelDateToYmd(cell: Cell?): String {
        val d = getCellDate(cell) ?: return ""
        return d.format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE)
    }

    private fun getExistingRows(
        sheet: Sheet,
        layout: SheetLayout,
        dataStartRow: Int, // 1-based（legacy の dataStartRow に合わせる）
        cols: SheetColumns
    ): Pair<List<ExistingRow>, Int> {
        val rows = mutableListOf<ExistingRow>()
        var lastDataRow = dataStartRow - 1
        for (r in (dataStartRow - 1)..sheet.lastRowNum) {
            val row = sheet.getRow(r) ?: continue
            val dateCell = row.getCell(cols.dateCol)
            if (!isCellNotEmpty(dateCell)) continue
            // 日付セルが空でない場合のみデータ行とみなす
            val dateVal = getCellDate(dateCell) ?: continue
            lastDataRow = r + 1 // 1-based
            val ymd = dateVal.format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE)
            val description = getCellString(row.getCell(cols.descCol)).trim()
            var income = 0L
            var expense = 0L
            if (layout == SheetLayout.CREDIT_CARD) {
                income = getCellLong(row.getCell(cols.amountCol))
            } else {
                income = getCellLong(row.getCell(cols.incomeCol))
                expense = getCellLong(row.getCell(cols.expenseCol))
            }
            rows.add(ExistingRow(ymd, description, income, expense))
        }
        return rows to lastDataRow
    }

    // 重複チェックによる増分インポート
    fun filterNewTransactions(
        transactions: List<ImportedTransaction>,
        existing: List<ExistingRow>,
        layout: SheetLayout
    ): List<ImportedTransaction> {
        val existingCounts = mutableMapOf<String, Int>()
        for (row in existing) {
            val key = "${row.ymd}|${row.description}|${row.income}|${row.expense}"
            existingCounts[key] = (existingCounts[key] ?: 0) + 1
        }
        val usedCounts = mutableMapOf<String, Int>()
        val result = mutableListOf<ImportedTransaction>()
        for (tx in transactions) {
            val ymd = ImportParserService.dateToYmd(tx.date)
            val key = if (layout == SheetLayout.CREDIT_CARD) {
                "$ymd|${tx.description}|${tx.amount}|0"
            } else {
                val income = if (tx.category == "入金") tx.amount else 0L
                val expense = if (tx.category == "出金") tx.amount else 0L
                "$ymd|${tx.description}|$income|$expense"
            }
            val existCount = existingCounts[key] ?: 0
            val usedCount = usedCounts[key] ?: 0
            if (usedCount < existCount) {
                usedCounts[key] = usedCount + 1
            } else {
                result.add(tx)
            }
        }
        return result
    }

    // 取引データをExcelワークシートに転記する（writeTransactionsToSheet に対応）
    // 戻り値は書き込んだ件数
    fun writeTransactionsToSheet(
        excelFile: File,
        sheetName: String,
        transactions: List<ImportedTransaction>,
        layoutParam: SheetLayout? = null,
        hasOpeningBalance: Boolean? = null
    ): Int {
        val workbook = openWorkbook(excelFile)
        try {
            var sheet = workbook.getSheet(sheetName)
            var cols = SheetColumns()
            if (sheet != null && sheet.physicalNumberOfRows > 0) {
                cols = detectSheetColumns(sheet)
            }
            var layout = layoutParam ?: SheetLayout.BANK
            if (layoutParam == null && sheet != null && sheet.physicalNumberOfRows > 0) {
                layout = if (cols.isSplitFormat) SheetLayout.BANK else SheetLayout.CREDIT_CARD
            }
            // 既存シートの2行目に「前期繰越」があるかを動的に検出
            var hasOpeningRow = false
            if (sheet != null && sheet.lastRowNum >= 1) {
                val secondRow = sheet.getRow(1)
                if (secondRow != null) {
                    val v = getCellString(secondRow.getCell(cols.descCol)).trim()
                    if (v == "前期繰越") hasOpeningRow = true
                }
            }
            val useOpeningBalance = hasOpeningBalance ?: if (sheet != null) hasOpeningRow else (layout == SheetLayout.BANK)
            val dataStartRow = if (useOpeningBalance) 3 else 2 // 1-based
            val sorted = transactions.sortedBy { it.date }
            val headers = if (layout == SheetLayout.CREDIT_CARD) {
                listOf("日付", "勘定科目", "摘要", "金額", "備考")
            } else {
                listOf("日付", "勘定科目", "摘要", "入金", "支払", "残高", "備考")
            }
            val toWrite: List<ImportedTransaction>
            var startRow: Int // 1-based
            if (sheet == null) {
                sheet = workbook.createSheet(sheetName)
                val headerRow = sheet.createRow(0)
                headers.forEachIndexed { i, h ->
                    val cell = headerRow.createCell(i)
                    cell.setCellValue(h)
                }
                // ヘッダーのスタイル（太字・中央寄せ）
                val headerStyle = workbook.createCellStyle()
                val headerFont = workbook.createFont()
                headerFont.bold = true
                headerStyle.setFont(headerFont)
                headerStyle.alignment = HorizontalAlignment.CENTER
                for (i in headers.indices) {
                    headerRow.getCell(i).cellStyle = headerStyle
                }
                // 新規シートの列位置をヘッダーから再検出
                cols = detectSheetColumns(sheet)
                // legacy と同様に前期繰越行を作成
                if (useOpeningBalance) {
                    val openingRow = sheet.createRow(1)
                    openingRow.createCell(cols.descCol).setCellValue("前期繰越")
                }
                startRow = dataStartRow
                toWrite = sorted
            } else {
                val (existingRows, lastDataRow) = getExistingRows(sheet, layout, dataStartRow, cols)
                toWrite = if (existingRows.isNotEmpty()) {
                    filterNewTransactions(sorted, existingRows, layout)
                } else {
                    sorted
                }
                startRow = maxOf(dataStartRow, lastDataRow + 1)
            }
            if (toWrite.isEmpty()) return 0
            val dateStyle = workbook.createCellStyle()
            dateStyle.dataFormat = workbook.createDataFormat().getFormat("YYYY/MM/DD")
            val amountStyle = workbook.createCellStyle()
            amountStyle.dataFormat = workbook.createDataFormat().getFormat("#,##0")
            for ((i, tx) in toWrite.withIndex()) {
                val rowIdx = (startRow + i) - 1 // 0-based
                var row = sheet.getRow(rowIdx)
                if (row == null) row = sheet.createRow(rowIdx)
                // 日付（タイムゾーンずれ防止のため正午で書き込む）
                val zoned = tx.date.atTime(12, 0).atZone(ZoneId.systemDefault())
                val utilDate = Date.from(zoned.toInstant())
                var dateCell = row.getCell(cols.dateCol)
                if (dateCell == null) dateCell = row.createCell(cols.dateCol)
                dateCell.setCellValue(utilDate)
                dateCell.cellStyle = dateStyle
                // 勘定科目・補助科目（TSV直接生成などの JournalEntry 形式に対応）
                val account = tx.creditAccount?.ifEmpty { null } ?: tx.debitAccount?.ifEmpty { null } ?: ""
                val subAccount = tx.creditSubAccount?.ifEmpty { null } ?: tx.debitSubAccount?.ifEmpty { null } ?: ""
                var accountCell = row.getCell(cols.accountCol)
                if (accountCell == null) accountCell = row.createCell(cols.accountCol)
                accountCell.setCellValue(account)
                if (cols.subAccountCol >= 0 && subAccount.isNotEmpty()) {
                    var subCell = row.getCell(cols.subAccountCol)
                    if (subCell == null) subCell = row.createCell(cols.subAccountCol)
                    subCell.setCellValue(subAccount)
                }
                var descCell = row.getCell(cols.descCol)
                if (descCell == null) descCell = row.createCell(cols.descCol)
                descCell.setCellValue(tx.description)
                if (tx.memo != null && cols.memoCol >= 0) {
                    var memoCell = row.getCell(cols.memoCol)
                    if (memoCell == null) memoCell = row.createCell(cols.memoCol)
                    memoCell.setCellValue(tx.memo)
                }
                if (layout == SheetLayout.CREDIT_CARD) {
                    var amountCell = row.getCell(cols.amountCol)
                    if (amountCell == null) amountCell = row.createCell(cols.amountCol)
                    amountCell.setCellValue(tx.amount.toDouble())
                    amountCell.cellStyle = amountStyle
                } else {
                    var inCell = row.getCell(cols.incomeCol)
                    if (inCell == null) inCell = row.createCell(cols.incomeCol)
                    var exCell = row.getCell(cols.expenseCol)
                    if (exCell == null) exCell = row.createCell(cols.expenseCol)
                    if (tx.category == "入金") {
                        inCell.setCellValue(tx.amount.toDouble())
                        inCell.cellStyle = amountStyle
                        exCell.setBlank()
                    } else {
                        inCell.setBlank()
                        exCell.setCellValue(tx.amount.toDouble())
                        exCell.cellStyle = amountStyle
                    }
                    if (tx.balance != null) {
                        var balCell = row.getCell(cols.balanceCol)
                        if (balCell == null) balCell = row.createCell(cols.balanceCol)
                        balCell.setCellValue(tx.balance!!.toDouble())
                        balCell.cellStyle = amountStyle
                    }
                }
            }
            // 前期繰越残高の自動記入
            if (useOpeningBalance) {
                val openingRow = sheet.getRow(1)
                if (openingRow != null) {
                    val balCell = openingRow.getCell(cols.balanceCol)
                    val hasValue = balCell != null && isCellNotEmpty(balCell) && getCellLong(balCell) != 0L
                    // legacy は「値なし」の場合のみ記入する（0 も未記入扱いではない点に注意）
                    val isEmpty = balCell == null || !isCellNotEmpty(balCell)
                    if (isEmpty && !hasValue) {
                        var openingBalance: Long? = null
                        val settingsSheet = workbook.getSheet("設定")
                        if (settingsSheet != null) {
                            for (r in 3..settingsSheet.lastRowNum) {
                                val srow = settingsSheet.getRow(r) ?: continue
                                val cellA = getCellString(srow.getCell(0)).trim()
                                if (cellA == sheetName) {
                                    val balVal = srow.getCell(6)
                                    if (balVal != null && isCellNotEmpty(balVal)) {
                                        openingBalance = getCellLong(balVal)
                                    }
                                }
                            }
                        }
                        if (openingBalance == null && sorted.isNotEmpty()) {
                            val firstTx = sorted[0]
                            if (firstTx.balance != null) {
                                val income = if (firstTx.category == "入金") firstTx.amount else 0L
                                val expense = if (firstTx.category == "出金") firstTx.amount else 0L
                                openingBalance = firstTx.balance!! - income + expense
                            }
                        }
                        if (openingBalance != null) {
                            var target = openingRow.getCell(cols.balanceCol)
                            if (target == null) target = openingRow.createCell(cols.balanceCol)
                            target.setCellValue(openingBalance!!.toDouble())
                            target.cellStyle = amountStyle
                        }
                    }
                }
            }
            FileOutputStream(excelFile).use { out -> workbook.write(out) }
            return toWrite.size
        } finally {
            workbook.close()
        }
    }

    // ファイルからテキストを抽出する（extract-text-from-files に対応）
    // HTML はプレーンテキストに変換し、先頭4万文字に切り詰める
    fun extractTextFromFiles(files: List<File>): ExtractResult {
        var combinedText = ""
        for (fp in files) {
            if (combinedText.length > 50000) break
            val lower = fp.name.lowercase()
            val raw = try {
                ImportParserService.readFileWithEncoding(fp, "UTF-8")
            } catch (e: Exception) {
                fp.readText(Charsets.UTF_8)
            }
            val text = if (lower.endsWith(".html") || lower.endsWith(".htm")) {
                ImportParserService.htmlToPlainText(raw)
            } else {
                raw
            }
            combinedText += "\n--- File: ${fp.name} ---\n$text\n"
        }
        if (combinedText.length > 40000) {
            combinedText = combinedText.substring(0, 40000) + "\n\n...（データサイズが非常に大きいため、JSON構造解析用に先頭の一部のみを抽出しました）"
        }
        return ExtractResult(combinedText, files)
    }

    // AI用プロンプト生成（ImportPanel.tsx の handleExtractAndPrompt に対応）
    fun buildJsonPrompt(target: ImportTargetSheet, sampleText: String): String {
        val typeDef = """
interface PluginConfig {
  id: string; // UUID等を指定
  name: string; // 表示名
  description: string;
  format: 'text' | 'csv' | 'html'; // テキストから正規表現で抽出する場合は'text'を指定
  encoding: string; // 'UTF-8' 等
  supportedExtensions: string[]; // ['.html', '.csv', '.txt'] 等
  targetSheet: string;
  defaultDebitAccount: string;
  defaultDebitSubAccount?: string;
  defaultCreditAccount: string;
  defaultCreditSubAccount?: string;
  // formatが'text'の場合に使用する正規表現ルール
  textPatterns?: {
    blockSeparator: string; // 各取引レコードを分割するための正規表現
    date: string; // 日付抽出用の正規表現 (キャプチャグループ1が日付になるように)
    description: string; // 摘要抽出用の正規表現
    amount: string; // 金額抽出用の正規表現
  };
}
""".trimIndent()
        val sub = if (!target.subAccount.isNullOrEmpty()) " / ${target.subAccount}" else ""
        return """あなたは青色申告アプリの「インポート設定JSON」を作成するエキスパートAIです。
対象シート: ${target.sheetName}
デフォルト科目: ${target.account}$sub

以下の「PluginConfig」の型定義に厳密に従ってJSONを生成してください。独自のプロパティ（extraction_rules等）は絶対に追加しないでください。
$typeDef

【指示】
・出力はJSONブロック(```json)のみとしてください。
・対象データはHTMLをプレーンテキストに変換したものです。formatは「text」を指定し、textPatternsを使用してデータを抽出する設定にしてください。
・textPatternsの正規表現では、必ず抽出したい値をキャプチャグループ()で囲んでください。
・targetSheetは必ず「${target.sheetName}」にしてください。
・デフォルトの借方・貸方の科目を適切に設定してください。（ただし、相手先の勘定科目と補助科目は未払金やクレジットカードとは限らないため、常に空欄「""」に設定してください）

【抽出データサンプル】
$sampleText"""
    }

    fun buildTsvPrompt(target: ImportTargetSheet, sampleText: String): String {
        val sub = if (!target.subAccount.isNullOrEmpty()) " / ${target.subAccount}" else ""
        return """あなたは会計データの入力アシスタントです。
対象シート: ${target.sheetName}
対象シートの基準科目: ${target.account}$sub

以下の抽出テキストから取引を抽出し、「日付(YYYY/MM/DD)」「勘定科目」「補助科目」「摘要」「金額(カンマなし数値)」「備考」の順でタブ区切り（TSV）で出力してください。ヘッダは不要です。
【重要】相手先の勘定科目と補助科目は未払金やクレジットカードとは限らないため、TSVの「勘定科目」「補助科目」列は常に空欄（タブ区切りで値なし）にして出力してください。

$sampleText"""
    }

    // JSON設定によるプレビュー（preview-with-json に対応）
    fun previewWithJson(jsonStr: String, files: List<File>): Pair<List<ImportedTransaction>, List<JournalEntry>> {
        var cleaned = jsonStr.trim()
        if (cleaned.startsWith("```json")) {
            cleaned = cleaned.replace("```json", "").replace("```", "").trim()
        } else if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace("```", "").trim()
        }
        val config = PluginConfigJson.parse(cleaned)
        val transactions = ImportParserService.parseFiles(config, files)
        val entries = ImportParserService.toJournalEntries(config, transactions)
        return transactions to entries
    }

    // ===== POI セルヘルパー（ExcelLoader と同等） =====

    private fun getCellString(cell: Cell?): String {
        if (cell == null) return ""
        return when (cell.cellType) {
            CellType.STRING -> cell.stringCellValue.trim()
            CellType.NUMERIC -> {
                if (DateUtil.isCellDateFormatted(cell)) cell.localDateTimeCellValue.toLocalDate().toString()
                else cell.numericCellValue.toLong().toString()
            }
            CellType.BOOLEAN -> cell.booleanCellValue.toString()
            CellType.FORMULA -> {
                try {
                    cell.stringCellValue.trim()
                } catch (e: Exception) {
                    try {
                        cell.numericCellValue.toLong().toString()
                    } catch (ex: Exception) {
                        ""
                    }
                }
            }
            else -> ""
        }
    }

    private fun getCellLong(cell: Cell?): Long {
        return getCellDouble(cell)?.toLong() ?: 0L
    }

    private fun getCellDouble(cell: Cell?): Double? {
        if (cell == null) return null
        return when (cell.cellType) {
            CellType.NUMERIC -> cell.numericCellValue
            CellType.STRING -> cell.stringCellValue.replace(",", "").trim().toDoubleOrNull()
            CellType.FORMULA -> {
                try {
                    cell.numericCellValue
                } catch (e: Exception) {
                    try {
                        cell.stringCellValue.replace(",", "").trim().toDoubleOrNull()
                    } catch (ex: Exception) {
                        null
                    }
                }
            }
            else -> null
        }
    }

    private fun getCellDate(cell: Cell?): LocalDate? {
        if (cell == null) return null
        return try {
            if (cell.cellType == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
                cell.dateCellValue.toInstant().atZone(ZoneId.systemDefault()).toLocalDate()
            } else if (cell.cellType == CellType.STRING) {
                parseDateString(cell.stringCellValue.trim())
            } else if (cell.cellType == CellType.FORMULA) {
                if (DateUtil.isCellDateFormatted(cell)) {
                    cell.dateCellValue.toInstant().atZone(ZoneId.systemDefault()).toLocalDate()
                } else {
                    try {
                        parseDateString(cell.stringCellValue.trim())
                    } catch (e: Exception) {
                        null
                    }
                }
            } else null
        } catch (e: Exception) {
            null
        }
    }

    private fun parseDateString(str: String): LocalDate? {
        if (str.isEmpty()) return null
        val parts = str.split("/", "-")
        if (parts.size == 3) {
            val y = parts[0].toIntOrNull()
            val m = parts[1].toIntOrNull()
            val d = parts[2].toIntOrNull()
            if (y != null && m != null && d != null) return LocalDate.of(y, m, d)
        }
        return try {
            LocalDate.parse(str)
        } catch (e: Exception) {
            null
        }
    }

    private fun isCellNotEmpty(cell: Cell?): Boolean {
        if (cell == null) return false
        if (cell.cellType == CellType.BLANK) return false
        if (cell.cellType == CellType.STRING) return cell.stringCellValue.trim().isNotEmpty()
        return true
    }
}
