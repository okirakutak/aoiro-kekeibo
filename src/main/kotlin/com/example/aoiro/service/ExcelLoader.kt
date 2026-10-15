package com.example.aoiro.service

import com.example.aoiro.model.JournalEntry
import org.apache.poi.ss.usermodel.*
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

object ExcelLoader {

    private data class TargetSheetConfig(
        val name: String,
        val defaultCredit: String,
        val defaultCreditSub: String? = null
    )

    private data class InitialBalanceConfig(
        val account: String,
        val sub: String? = null,
        val amount: Long
    )

    fun loadJournalEntries(file: File): List<JournalEntry> {        val workbook = WorkbookFactory.create(file)
        val entries = mutableListOf<JournalEntry>()

        val settingsSheet = workbook.getSheet("設定")
        val targetSheets = mutableListOf(TargetSheetConfig("現金出納帳", "現金"))
        val initialBalances = mutableListOf<InitialBalanceConfig>()
        var targetYear = LocalDate.now().year

        if (settingsSheet != null) {
            // 1行目 (index 0)
            val yearRow = settingsSheet.getRow(0)
            if (yearRow != null) {
                val yearLabel = getCellString(yearRow.getCell(0))
                if (yearLabel == "対象年度") {
                    val yVal = getCellLong(yearRow.getCell(1))
                    if (yVal > 0) targetYear = yVal.toInt()
                }
            }

            // 4行目以降 (index 3..)
            for (r in 3..settingsSheet.lastRowNum) {
                val row = settingsSheet.getRow(r) ?: continue
                val sheetName = getCellString(row.getCell(0))
                val account = getCellString(row.getCell(1))
                val subAccount = getCellString(row.getCell(2))

                if (account.isEmpty()) continue

                if (sheetName.isNotEmpty()) {
                    if (targetSheets.none { it.name == sheetName }) {
                        targetSheets.add(TargetSheetConfig(sheetName, account, subAccount.ifEmpty { null }))
                    }
                }

                val balanceCell = row.getCell(5) // 6列目 (index 5)
                val balAmt = getCellLong(balanceCell)
                val hasBalance = isCellNotEmpty(balanceCell)
                if (hasBalance) {
                    initialBalances.add(InitialBalanceConfig(account, subAccount.ifEmpty { null }, balAmt))
                }
            }
        }

        // 1. 期首残高（開始仕訳）
        val openingDate = LocalDate.of(targetYear, 1, 1)
        for (ib in initialBalances) {
            val isLiability = ib.account.matches(Regex(".*(未払金|買掛金|借入金|預り金|事業主借).*"))
            entries.add(
                JournalEntry(
                    id = UUID.randomUUID().toString(),
                    date = openingDate,
                    debitAccount = if (isLiability) "元入金" else ib.account,
                    debitSubAccount = if (isLiability) null else ib.sub,
                    creditAccount = if (isLiability) ib.account else "元入金",
                    creditSubAccount = if (isLiability) ib.sub else null,
                    amount = ib.amount,
                    description = "前期繰越",
                    note = "自動生成された開始仕訳",
                    sourceSheet = "設定"
                )
            )
        }

        // 2. 「仕訳帳」シートのパース
        val generalJournal = workbook.getSheet("仕訳帳")
        if (generalJournal != null) {
            for (r in 1..generalJournal.lastRowNum) {
                val row = generalJournal.getRow(r) ?: continue
                val dateVal = getCellDate(row.getCell(0)) ?: continue
                val debitAcc = getCellString(row.getCell(1))
                if (debitAcc.isEmpty()) continue
                val debitSub = getCellString(row.getCell(2)).ifEmpty { null }
                val amountVal = getCellDouble(row.getCell(3)) ?: continue
                val amount = amountVal.toLong()
                val desc = getCellString(row.getCell(4))
                val creditAcc = getCellString(row.getCell(5)).ifEmpty { debitAcc }
                val creditSub = getCellString(row.getCell(6)).ifEmpty { null }

                entries.add(
                    JournalEntry(
                        id = UUID.randomUUID().toString(),
                        date = dateVal,
                        debitAccount = debitAcc,
                        debitSubAccount = debitSub,
                        creditAccount = creditAcc,
                        creditSubAccount = creditSub,
                        amount = amount,
                        description = desc,
                        sourceSheet = "仕訳帳"
                    )
                )
            }
        }

        // 3. その他の帳簿シートのパース
        for (target in targetSheets) {
            if (target.name == "仕訳帳") continue
            val sheet = workbook.getSheet(target.name) ?: continue

            val cols = detectCols(sheet)
            val headerRow = sheet.getRow(0)
            val hasBalanceColumn = if (headerRow != null && cols.balanceCol >= 0) {
                getCellString(headerRow.getCell(cols.balanceCol)).trim() == "残高"
            } else false

            for (r in 1..sheet.lastRowNum) {
                val row = sheet.getRow(r) ?: continue

                // 残高列があるシートで残高欄が空欄の行はスキップ（二重計上防止）
                if (hasBalanceColumn) {
                    val balanceVal = row.getCell(cols.balanceCol)
                    if (!isCellNotEmpty(balanceVal)) continue
                }

                val inVal = getCellDouble(row.getCell(cols.incomeCol))
                val outVal = getCellDouble(row.getCell(cols.expenseCol))

                var amount = 0L
                var isIncome = false

                if (cols.isSplitFormat) {
                    if (inVal != null && inVal != 0.0) {
                        amount = inVal.toLong()
                        isIncome = true
                    } else if (outVal != null && outVal != 0.0) {
                        amount = outVal.toLong()
                        isIncome = false
                    } else {
                        continue // 金額がない行はスキップ
                    }
                } else {
                    if (inVal != null) {
                        if (inVal < 0) {
                            amount = Math.abs(inVal.toLong())
                            isIncome = true
                        } else {
                            amount = inVal.toLong()
                            isIncome = false
                        }
                    } else {
                        continue // 金額がない行はスキップ
                    }
                }

                val dateVal = getCellDate(row.getCell(cols.dateCol)) ?: continue
                val accountName = getCellString(row.getCell(cols.accountCol))
                val description = getCellString(row.getCell(cols.descriptionCol))
                val subAccountName = if (cols.subAccountCol >= 0) getCellString(row.getCell(cols.subAccountCol)).ifEmpty { null } else null

                entries.add(
                    JournalEntry(
                        id = UUID.randomUUID().toString(),
                        date = dateVal,
                        debitAccount = if (isIncome) target.defaultCredit else accountName,
                        debitSubAccount = if (isIncome) target.defaultCreditSub else subAccountName,
                        creditAccount = if (isIncome) accountName else target.defaultCredit,
                        creditSubAccount = if (isIncome) subAccountName else target.defaultCreditSub,
                        amount = amount,
                        description = description,
                        sourceSheet = target.name
                    )
                )
            }
        }

        workbook.close()

        val filtered = entries.filter { it.date.year == targetYear }

        return filtered.sortedWith(Comparator { a, b ->
            if (a.date != b.date) {
                a.date.compareTo(b.date)
            } else {
                val aIsOpening = a.description == "前期繰越"
                val bIsOpening = b.description == "前期繰越"
                when {
                    aIsOpening && !bIsOpening -> -1
                    !aIsOpening && bIsOpening -> 1
                    else -> 0
                }
            }
        })
    }

    /**
     * 「勘定科目」シートから id 順の勘定科目名リストを読み込む。
     * 1行目はヘッダー（id, name, type）を想定し、2行目以降の id 数値昇順で並べ替えて返す。
     * シートが存在しない場合は空リストを返す。
     */
    fun loadAccountOrder(file: File): List<String> {
        val workbook = WorkbookFactory.create(file)
        try {
            val sheet = workbook.getSheet("勘定科目") ?: return emptyList()
            val idToName = mutableListOf<Pair<Long, String>>()
            for (r in 1..sheet.lastRowNum) {
                val row = sheet.getRow(r) ?: continue
                val id = getCellLong(row.getCell(0))
                if (id <= 0) continue
                val name = getCellString(row.getCell(1))
                if (name.isEmpty()) continue
                idToName.add(id to name)
            }
            return idToName.sortedBy { it.first }.map { it.second }
        } finally {
            workbook.close()
        }
    }

    /**
     * 「勘定科目」シートから科目名→種別マップを読み込む。
     * ヘッダー（id, name, type）を想定し、種別が空の行は除外する。
     * シートが存在しない場合は空マップを返す。
     */
    fun loadAccountTypes(file: File): Map<String, String> {
        val workbook = WorkbookFactory.create(file)
        try {
            val sheet = workbook.getSheet("勘定科目") ?: return emptyMap()
            val types = mutableMapOf<String, String>()
            for (r in 1..sheet.lastRowNum) {
                val row = sheet.getRow(r) ?: continue
                val name = getCellString(row.getCell(1))
                if (name.isEmpty()) continue
                val type = getCellString(row.getCell(2))
                if (type.isEmpty()) continue
                types[name] = type
            }
            return types
        } finally {
            workbook.close()
        }
    }

    private data class ParsedCols(
        val dateCol: Int = 0,
        val accountCol: Int = 1,
        val subAccountCol: Int = 2,
        val descriptionCol: Int = 3,
        val incomeCol: Int = 4,
        val expenseCol: Int = 5,
        val balanceCol: Int = 6,
        val isSplitFormat: Boolean = false
    )

    private fun detectCols(sheet: Sheet): ParsedCols {
        val headerRow = sheet.getRow(0)
        var dateCol = 0
        var accountCol = 1
        var subAccountCol = 2
        var descriptionCol = 3
        var incomeCol = 4
        var expenseCol = 5
        var balanceCol = 6
        var foundExpense = false

        if (headerRow != null) {
            var fDate = -1
            var fAccount = -1
            var fSub = -1
            var fDesc = -1
            var fInc = -1
            var fExp = -1
            var fBal = -1

            for (c in 0 until headerRow.lastCellNum) {
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
            }

            if (fDate >= 0) dateCol = fDate
            if (fAccount >= 0) accountCol = fAccount
            if (fSub >= 0) subAccountCol = fSub
            if (fDesc >= 0) descriptionCol = fDesc
            if (fInc >= 0) incomeCol = fInc
            if (fExp >= 0) expenseCol = fExp
            if (fBal >= 0) balanceCol = fBal
        }

        val isSplitFormat = foundExpense && incomeCol != expenseCol
        return ParsedCols(dateCol, accountCol, subAccountCol, descriptionCol, incomeCol, expenseCol, balanceCol, isSplitFormat)
    }

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
                    try { cell.numericCellValue.toLong().toString() } catch (ex: Exception) { "" }
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
            CellType.STRING -> {
                val txt = cell.stringCellValue.replace(",", "").trim()
                txt.toDoubleOrNull()
            }
            CellType.FORMULA -> {
                try {
                    cell.numericCellValue
                } catch (e: Exception) {
                    try {
                        cell.stringCellValue.replace(",", "").trim().toDoubleOrNull()
                    } catch (ex: Exception) { null }
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
                    parseDateString(cell.stringCellValue.trim())
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
            if (y != null && m != null && d != null) {
                return LocalDate.of(y, m, d)
            }
        }
        return try { LocalDate.parse(str) } catch (e: Exception) { null }
    }

    private fun isCellNotEmpty(cell: Cell?): Boolean {
        if (cell == null) return false
        if (cell.cellType == CellType.BLANK) return false
        if (cell.cellType == CellType.STRING) {
            return cell.stringCellValue.trim().isNotEmpty()
        }
        return true
    }
}
