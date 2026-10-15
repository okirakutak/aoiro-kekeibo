package com.example.aoiro.service

import com.example.aoiro.model.*
import org.jsoup.Jsoup
import java.io.File
import java.nio.charset.Charset
import java.nio.file.Files
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

// 汎用パーサーエンジン（config-parser-engine.ts の Kotlin 移植）
object ImportParserService {

    // ファイルを指定エンコーディングで読み込み、UTF-8文字列として返す（BOM除去付き）
    fun readFileWithEncoding(file: File, encoding: String): String {
        val bytes = Files.readAllBytes(file.toPath())
        val enc = encoding.trim().lowercase().replace("_", "").replace("-", "")
        return when (enc) {
            "utf8", "utf8n", "utf" -> {
                var text = String(bytes, Charsets.UTF_8)
                if (text.isNotEmpty() && text[0] == '\uFEFF') text = text.substring(1)
                text
            }
            "shiftjis", "shift Jis", "sjis", "ms932", "windows31j", "windows932" -> {
                String(bytes, Charset.forName("Windows-31J"))
            }
            else -> {
                try {
                    String(bytes, Charset.forName(encoding))
                } catch (e: Exception) {
                    String(bytes, Charsets.UTF_8)
                }
            }
        }
    }

    // 列指定から値を取得する
    fun getColumnValue(row: List<String>, spec: ColumnSpec): String {
        return when (spec) {
            is ColumnSpec.Single -> row.getOrNull(spec.index)?.trim() ?: ""
            is ColumnSpec.Joined -> spec.indices.map { row.getOrNull(it)?.trim() ?: "" }.joinToString(spec.join)
        }
    }

    // 金額文字列を数値に変換する（カンマ、円記号、空白を除去、絶対値）
    fun parseAmount(text: String?): Long {
        if (text.isNullOrEmpty()) return 0L
        val cleaned = text.replace(Regex("[,¥￥\\s円]"), "").trim()
        if (cleaned.isEmpty()) return 0L
        val num = cleaned.toDoubleOrNull() ?: return 0L
        return Math.abs(num).toLong()
    }

    // 日付文字列を LocalDate に変換する（複数のフォーマットに対応）
    fun parseDate(text: String?): LocalDate {
        if (text.isNullOrEmpty()) return LocalDate.now()
        val cleaned = text.trim()
        // YYYYMMDD（8桁数字）
        if (Regex("^\\d{8}$").matches(cleaned)) {
            val y = cleaned.substring(0, 4).toInt()
            val m = cleaned.substring(4, 6).toInt()
            val d = cleaned.substring(6, 8).toInt()
            return LocalDate.of(y, m, d)
        }
        // YYMMDD（6桁数字、イオンカード用）
        if (Regex("^\\d{6}$").matches(cleaned)) {
            val y = 2000 + cleaned.substring(0, 2).toInt()
            val m = cleaned.substring(2, 4).toInt()
            val d = cleaned.substring(4, 6).toInt()
            return LocalDate.of(y, m, d)
        }
        // YYYY/MM/DD or YYYY-MM-DD
        if (Regex("^\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}$").matches(cleaned)) {
            val parts = cleaned.split(Regex("[/-]"))
            return LocalDate.of(parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
        }
        // YYYY年MM月DD日
        Regex("(\\d{4})年\\s*(\\d{1,2})月\\s*(\\d{1,2})日").find(cleaned)?.let {
            return LocalDate.of(it.groupValues[1].toInt(), it.groupValues[2].toInt(), it.groupValues[3].toInt())
        }
        // MM/DD, MM-DD（年なし → 当年補完）
        Regex("^(\\d{1,2})[/-](\\d{1,2})$").find(cleaned)?.let {
            val y = LocalDate.now().year
            return LocalDate.of(y, it.groupValues[1].toInt(), it.groupValues[2].toInt())
        }
        // 英語月名: Oct 7, 2024（Aliexpress用）
        Regex("([A-Za-z]+)\\s+(\\d{1,2}),?\\s+(\\d{4})").find(cleaned)?.let {
            val monthMap = mapOf(
                "jan" to 1, "feb" to 2, "mar" to 3, "apr" to 4, "may" to 5, "jun" to 6,
                "jul" to 7, "aug" to 8, "sep" to 9, "oct" to 10, "nov" to 11, "dec" to 12
            )
            val m = monthMap[it.groupValues[1].lowercase().take(3)] ?: return@let null
            // let からの return のため、直接返す
            return LocalDate.of(it.groupValues[3].toInt(), m, it.groupValues[2].toInt())
        }
        // その他: ISO パースを試行
        try {
            return LocalDate.parse(cleaned)
        } catch (e: Exception) {
            // fall through
        }
        try {
            return LocalDate.parse(cleaned, DateTimeFormatter.ofPattern("yyyy/M/d"))
        } catch (e: Exception) {
            // fall through
        }
        return LocalDate.now()
    }

    fun dateToYmd(d: LocalDate): String = d.format(DateTimeFormatter.ISO_LOCAL_DATE)

    // CSVパーサー（引用符・カンマ入り金額に対応した自前実装）
    // legacy の csv-parse（relax_quotes / relax_column_count / skip_empty_lines）に相当
    fun splitCsvLine(line: String, delimiter: Char): List<String> {
        val result = mutableListOf<String>()
        val current = StringBuilder()
        var inQuotes = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            if (c == '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
                    current.append('"')
                    i += 2
                    continue
                }
                inQuotes = !inQuotes
                i++
                continue
            }
            if (c == delimiter && !inQuotes) {
                result.add(current.toString())
                current.clear()
                i++
                continue
            }
            current.append(c)
            i++
        }
        result.add(current.toString())
        return result
    }

    // CSVパーサー
    fun parseCsv(config: PluginConfig, file: File): List<ImportedTransaction> {
        val content = readFileWithEncoding(file, config.encoding)
        val lines = content.split(Regex("\\r?\\n"))
        val skipRows = config.columns?.let { config.skipRows } ?: config.skipRows
        val dataLines = if (skipRows > 0 && skipRows < lines.size) lines.drop(skipRows) else lines
        val delimiterChar = when (config.delimiter) {
            "\\t", "tab", "\t" -> '\t'
            else -> config.delimiter.firstOrNull() ?: ','
        }
        val records: List<List<String>> = dataLines
            .filter { it.isNotBlank() }
            .map { splitCsvLine(it, delimiterChar) }
        val columns = config.columns ?: return emptyList()
        val startIdx = if (config.hasHeader) 1 else 0
        val transactions = mutableListOf<ImportedTransaction>()
        for (i in startIdx until records.size) {
            val row = records[i]
            if (row.isEmpty() || row.all { it.isBlank() }) continue
            val dateStr = getColumnValue(row, columns.date)
            if (dateStr.isEmpty() || dateStr.replace("/", "").trim().isEmpty()) continue
            val date = try {
                parseDate(dateStr)
            } catch (e: Exception) {
                continue
            }
            // 残高が必須の場合、残高列が空欄の行はスキップ
            if (config.requireBalance && columns.balance != null) {
                val balStr = getColumnValue(row, columns.balance).trim()
                if (balStr.isEmpty()) continue
            }
            val description = getColumnValue(row, columns.description)
            var amount = 0L
            var isIncome = false
            if (columns.income != null && columns.expense != null) {
                val incomeVal = parseAmount(getColumnValue(row, columns.income))
                val expenseVal = parseAmount(getColumnValue(row, columns.expense))
                if (incomeVal > 0) {
                    amount = incomeVal
                    isIncome = true
                } else if (expenseVal > 0) {
                    amount = expenseVal
                    isIncome = false
                } else {
                    continue
                }
            } else if (columns.amount != null) {
                amount = parseAmount(getColumnValue(row, columns.amount))
                if (amount == 0L) continue
            } else {
                continue
            }
            val rawData = mutableMapOf<String, String>()
            row.forEachIndexed { idx, v -> rawData["col$idx"] = v }
            var balance: Long? = null
            if (columns.balance != null) {
                val balStr = getColumnValue(row, columns.balance)
                val bal = parseAmount(balStr)
                if (bal > 0 || balStr.trim() == "0") balance = bal
            }
            transactions.add(
                ImportedTransaction(
                    date = date, description = description, amount = amount,
                    category = if (isIncome) "入金" else "出金",
                    paymentMethod = config.name, balance = balance, rawData = rawData
                )
            )
        }
        // 年度フィルター
        if (config.filterYear != null) {
            return transactions.filter { it.date.year == config.filterYear }
        }
        return transactions
    }

    // HTMLパーサー（Jsoup による CSS セレクタ抽出）
    fun parseHtmlWithSelectors(config: PluginConfig, file: File, selectors: HtmlSelectorsConfig): List<ImportedTransaction> {
        val content = readFileWithEncoding(file, config.encoding)
        val doc = Jsoup.parse(content)
        val transactions = mutableListOf<ImportedTransaction>()
        val dateRegex = config.datePattern?.let { Regex(it) }
        val amountRegex = config.amountPattern?.let { Regex(it) }
        val rows = doc.select(selectors.row)
        for (el in rows) {
            val description = el.select(selectors.description).firstOrNull()?.text()?.trim() ?: continue
            if (description.isEmpty()) continue
            var dateStr = ""
            if (selectors.dateText != null) {
                val dateTextEl = el.select(selectors.dateText).firstOrNull()?.text()?.trim() ?: ""
                if (dateRegex != null) {
                    val match = dateRegex.find(dateTextEl)
                    if (match != null && match.groupValues.size > 1) {
                        dateStr = match.groupValues[1]
                    }
                } else {
                    dateStr = dateTextEl
                }
                // 属性指定がある場合は属性値を優先
                if (selectors.dateAttr != null) {
                    val attrVal = el.select(selectors.dateText).firstOrNull()?.attr(selectors.dateAttr)?.trim() ?: ""
                    if (attrVal.isNotEmpty()) dateStr = attrVal
                }
            }
            if (dateStr.isEmpty()) continue
            val date = try {
                parseDate(dateStr)
            } catch (e: Exception) {
                continue
            }
            var amountText = el.select(selectors.amount).firstOrNull()?.text()?.trim() ?: ""
            if (amountRegex != null) {
                val match = amountRegex.find(amountText)
                if (match != null) amountText = match.value
            }
            val amount = parseAmount(amountText)
            var orderId = ""
            if (selectors.orderId != null) {
                orderId = el.select(selectors.orderId).firstOrNull()?.text()?.trim() ?: ""
            }
            transactions.add(
                ImportedTransaction(
                    date = date, description = description, amount = amount,
                    paymentMethod = config.name,
                    rawData = mapOf("description" to description, "amount" to amountText, "date" to dateStr, "orderId" to orderId)
                )
            )
        }
        return transactions
    }

    // HTMLファイルをプレーンテキストに変換する（AIプロンプト生成時と同一条件）
    fun htmlToPlainText(html: String): String {
        val doc = Jsoup.parse(html)
        doc.select("nav, footer, script, style").remove()
        doc.select("img").remove()
        return doc.body()?.text() ?: doc.text()
    }

    // テキストパーサー（プレーンテキスト用）
    fun parseText(config: PluginConfig, file: File): List<ImportedTransaction> {
        var content = readFileWithEncoding(file, config.encoding)
        val lower = file.name.lowercase()
        if (lower.endsWith(".html") || lower.endsWith(".htm")) {
            content = htmlToPlainText(content)
        }
        val patterns = config.textPatterns ?: return emptyList()
        val separatorRegex = Regex("(?=${patterns.blockSeparator})")
        val blocks = content.split(separatorRegex).map { it.trim() }.filter { it.isNotEmpty() }
        val dateRegex = Regex(patterns.date)
        val descRegex = Regex(patterns.description)
        val amountRegex = Regex(patterns.amount)
        val orderIdRegex = patterns.orderId?.let { Regex(it) }
        val transactions = mutableListOf<ImportedTransaction>()
        for (block in blocks) {
            val dateMatch = dateRegex.find(block) ?: continue
            if (dateMatch.groupValues.size < 2) continue
            val dateStr = dateMatch.groupValues[1]
            val date = try {
                parseDate(dateStr)
            } catch (e: Exception) {
                continue
            }
            val amountMatch = amountRegex.find(block) ?: continue
            val amountVal = amountMatch.groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: continue
            val amount = parseAmount(amountVal)
            if (amount == 0L) continue
            val descMatch = descRegex.find(block) ?: continue
            if (descMatch.groupValues.size < 2) continue
            val description = descMatch.groupValues[1].trim()
            if (description.isEmpty()) continue
            var orderId = ""
            if (orderIdRegex != null) {
                val m = orderIdRegex.find(block)
                if (m != null && m.groupValues.size > 1) orderId = m.groupValues[1].trim()
            }
            transactions.add(
                ImportedTransaction(
                    date = date, description = description, amount = amount,
                    paymentMethod = config.name,
                    rawData = mapOf("description" to description, "amount" to amount.toString(), "date" to dateStr, "orderId" to orderId)
                )
            )
        }
        return transactions
    }

    // 残高チェーンに基づく並び替え
    fun sortWithBalanceChain(transactions: List<ImportedTransaction>): List<ImportedTransaction> {
        if (transactions.size <= 1) return transactions
        val byDate = mutableMapOf<String, MutableList<ImportedTransaction>>()
        for (tx in transactions) {
            val key = dateToYmd(tx.date)
            byDate.getOrPut(key) { mutableListOf() }.add(tx)
        }
        val dateKeys = byDate.keys.sorted()
        val result = mutableListOf<ImportedTransaction>()
        var lastBalance: Long? = null
        for (dateKey in dateKeys) {
            val group = byDate[dateKey]!!
            if (group.size == 1) {
                result.add(group[0])
                if (group[0].balance != null) lastBalance = group[0].balance
                continue
            }
            if (group.none { it.balance != null }) {
                result.addAll(group)
                continue
            }
            var chainBuilt = false
            if (lastBalance != null) {
                var currentBalance = lastBalance!!
                val ordered = mutableListOf<ImportedTransaction>()
                val remaining = group.toMutableList()
                while (remaining.isNotEmpty()) {
                    var found = false
                    for (i in remaining.indices) {
                        val tx = remaining[i]
                        if (tx.balance == null) continue
                        val income = if (tx.category == "入金") tx.amount else 0L
                        val expense = if (tx.category == "出金") tx.amount else 0L
                        val prevBalance = tx.balance!! - income + expense
                        if (Math.abs((prevBalance - currentBalance).toDouble()) < 0.01) {
                            ordered.add(tx)
                            currentBalance = tx.balance!!
                            remaining.removeAt(i)
                            found = true
                            break
                        }
                    }
                    if (!found) {
                        ordered.addAll(remaining)
                        remaining.clear()
                    }
                }
                result.addAll(ordered)
                val lastTx = ordered.lastOrNull()
                if (lastTx?.balance != null) lastBalance = lastTx.balance
                chainBuilt = true
            }
            if (!chainBuilt) {
                val withBalance = group.filter { it.balance != null }
                if (withBalance.size >= 2) {
                    data class ChainNode(val tx: ImportedTransaction, val prevBalance: Long)
                    val nodes = withBalance.map { tx ->
                        val income = if (tx.category == "入金") tx.amount else 0L
                        val expense = if (tx.category == "出金") tx.amount else 0L
                        ChainNode(tx, tx.balance!! - income + expense)
                    }
                    val ordered = mutableListOf<ImportedTransaction>()
                    val used = mutableSetOf<Int>()
                    var startIdx = 0
                    for (i in nodes.indices) {
                        val prevBal = nodes[i].prevBalance
                        val isLinkedFrom = nodes.indices.any { j ->
                            j != i && Math.abs((nodes[j].tx.balance!! - prevBal).toDouble()) < 0.01
                        }
                        if (!isLinkedFrom) {
                            startIdx = i
                            break
                        }
                    }
                    var currentBal = nodes[startIdx].prevBalance
                    while (ordered.size < nodes.size) {
                        var found = false
                        for (i in nodes.indices) {
                            if (i in used) continue
                            if (Math.abs((nodes[i].prevBalance - currentBal).toDouble()) < 0.01) {
                                ordered.add(nodes[i].tx)
                                currentBal = nodes[i].tx.balance!!
                                used.add(i)
                                found = true
                                break
                            }
                        }
                        if (!found) {
                            for (i in nodes.indices) {
                                if (i !in used) {
                                    ordered.add(nodes[i].tx)
                                    used.add(i)
                                }
                            }
                            break
                        }
                    }
                    val withoutBalance = group.filter { it.balance == null }
                    result.addAll(ordered)
                    result.addAll(withoutBalance)
                    val lastTx = ordered.lastOrNull()
                    if (lastTx?.balance != null) lastBalance = lastTx.balance
                } else {
                    result.addAll(group)
                    val lastTx = group.lastOrNull()
                    if (lastTx?.balance != null) lastBalance = lastTx.balance
                }
            }
        }
        return result
    }

    // 複数ファイルパース（multiFile対応）
    fun parseFiles(config: PluginConfig, filePaths: List<File>): List<ImportedTransaction> {
        val allTransactions = mutableListOf<ImportedTransaction>()
        val htmlListTxs = mutableListOf<ImportedTransaction>()
        val htmlDetailTxs = mutableListOf<ImportedTransaction>()
        for (fp in filePaths) {
            when (config.format.lowercase()) {
                "html" -> {
                    if (config.htmlMerge != null && config.selectors != null) {
                        val tList = parseHtmlWithSelectors(config, fp, config.selectors!!)
                        val tDetail = parseHtmlWithSelectors(config, fp, config.htmlMerge!!.detailSelectors)
                        if (tList.isNotEmpty() && tDetail.isEmpty()) {
                            htmlListTxs.addAll(tList)
                        } else if (tDetail.isNotEmpty() && tList.isEmpty()) {
                            htmlDetailTxs.addAll(tDetail)
                        } else if (tList.isNotEmpty() && tDetail.isNotEmpty()) {
                            if (tDetail.size >= tList.size) htmlDetailTxs.addAll(tDetail)
                            else htmlListTxs.addAll(tList)
                        }
                        continue
                    } else if (config.selectors != null) {
                        allTransactions.addAll(parseHtmlWithSelectors(config, fp, config.selectors!!))
                    }
                }
                "text" -> allTransactions.addAll(parseText(config, fp))
                else -> allTransactions.addAll(parseCsv(config, fp))
            }
        }
        // HTMLマージモードの後処理
        if (config.format.lowercase() == "html" && config.htmlMerge != null) {
            allTransactions.addAll(htmlDetailTxs)
            for (tx in htmlListTxs) {
                val key = if (config.htmlMerge!!.matchKey == "orderId") tx.rawData["orderId"] else tx.rawData["date"]
                val hasDetail = htmlDetailTxs.any {
                    (if (config.htmlMerge!!.matchKey == "orderId") it.rawData["orderId"] else it.rawData["date"]) == key
                }
                if (!hasDetail) allTransactions.add(tx)
            }
        }
        return sortWithBalanceChain(allTransactions)
    }

    // 取引明細を仕訳データに変換する
    fun toJournalEntries(
        config: PluginConfig,
        transactions: List<ImportedTransaction>,
        mappingRules: List<ConfigMappingRule>? = null
    ): List<JournalEntry> {
        val rules = mappingRules ?: config.mappingRules
        return transactions.map { tx ->
            var debitAcc = config.defaultDebitAccount
            var debitSub = config.defaultDebitSubAccount
            var creditAcc = config.defaultCreditAccount
            var creditSub = config.defaultCreditSubAccount
            if (tx.category == "入金") {
                debitAcc = config.defaultDebitAccount
                debitSub = config.defaultDebitSubAccount
                creditAcc = config.defaultCreditAccount
                creditSub = config.defaultCreditSubAccount
            } else {
                // 出金: 借方が相手科目、貸方がこの口座
                debitAcc = config.defaultCreditAccount
                debitSub = config.defaultCreditSubAccount
                creditAcc = config.defaultDebitAccount
                creditSub = config.defaultDebitSubAccount
            }
            for (rule in rules) {
                if (tx.description.contains(rule.keyword)) {
                    if (tx.category == "入金") {
                        creditAcc = rule.debitAccount
                        creditSub = rule.debitSubAccount
                    } else {
                        debitAcc = rule.debitAccount
                        debitSub = rule.debitSubAccount
                    }
                    if (rule.creditAccount != null) {
                        if (tx.category == "入金") {
                            debitAcc = rule.creditAccount!!
                            debitSub = rule.creditSubAccount
                        } else {
                            creditAcc = rule.creditAccount!!
                            creditSub = rule.creditSubAccount
                        }
                    }
                    break
                }
            }
            JournalEntry(
                id = UUID.randomUUID().toString(),
                date = tx.date,
                debitAccount = debitAcc,
                debitSubAccount = debitSub,
                creditAccount = creditAcc,
                creditSubAccount = creditSub,
                amount = tx.amount,
                description = tx.description,
                note = "",
                sourceSheet = config.name
            )
        }
    }

    // TSV直接パース（ImportPanel.tsx の handleAiInputNext direct モードに対応）
    // 列順: 日付(YYYY/MM/DD)、勘定科目、補助科目、摘要、金額、備考
    fun parseTsvDirect(tsvText: String): List<ImportedTransaction> {
        val lines = tsvText.trim().split("\n")
        return lines.mapNotNull { line ->
            if (line.isBlank()) return@mapNotNull null
            val cols = line.split("\t")
            val dateStr = cols.getOrNull(0)?.trim() ?: return@mapNotNull null
            if (dateStr.isEmpty()) return@mapNotNull null
            val date = try {
                parseDate(dateStr)
            } catch (e: Exception) {
                return@mapNotNull null
            }
            val creditAccount = cols.getOrNull(1)?.trim() ?: ""
            val creditSubAccount = cols.getOrNull(2)?.trim()?.ifEmpty { null }
            val description = cols.getOrNull(3)?.trim() ?: ""
            val amount = parseAmount(cols.getOrNull(4) ?: "0")
            val memo = cols.getOrNull(5)?.trim()?.ifEmpty { null }
            ImportedTransaction(
                date = date, description = description, amount = amount,
                category = "出金",
                creditAccount = creditAccount.ifEmpty { null },
                creditSubAccount = creditSubAccount,
                memo = memo,
                rawData = mapOf("date" to dateStr)
            )
        }
    }

    // 全角・半角・カタカナ・記号・スペースの表記揺れを吸収する文字列正規化関数
    fun normalizeText(str: String): String {
        if (str.isEmpty()) return ""
        var s = str
        // 半角カナ → 全角カナ
        val kanaMap = mapOf(
            "ｶﾞ" to "ガ", "ｷﾞ" to "ギ", "ｸﾞ" to "グ", "ｹﾞ" to "ゲ", "ｺﾞ" to "ゴ",
            "ｻﾞ" to "ザ", "ｼﾞ" to "ジ", "ｽﾞ" to "ズ", "ｾﾞ" to "ゼ", "ｿﾞ" to "ゾ",
            "ﾀﾞ" to "ダ", "ﾁﾞ" to "ヂ", "ﾂﾞ" to "ヅ", "ﾃﾞ" to "デ", "ﾄﾞ" to "ド",
            "ﾊﾞ" to "バ", "ﾋﾞ" to "ビ", "ﾌﾞ" to "ブ", "ﾍﾞ" to "ベ", "ﾎﾞ" to "ボ",
            "ﾊﾟ" to "パ", "ﾋﾟ" to "ピ", "ﾌﾟ" to "プ", "ﾍﾟ" to "ペ", "ﾎﾟ" to "ポ",
            "ｳﾞ" to "ヴ", "ｱ" to "ア", "ｲ" to "イ", "ｳ" to "ウ", "ｴ" to "エ", "ｵ" to "オ",
            "ｶ" to "カ", "ｷ" to "キ", "ｸ" to "ク", "ｹ" to "ケ", "ｺ" to "コ",
            "ｻ" to "サ", "ｼ" to "シ", "ｽ" to "ス", "ｾ" to "セ", "ｿ" to "ソ",
            "ﾀ" to "タ", "ﾁ" to "チ", "ﾂ" to "ツ", "ﾃ" to "テ", "ﾄ" to "ト",
            "ﾅ" to "ナ", "ﾆ" to "ニ", "ﾇ" to "ヌ", "ﾈ" to "ネ", "ﾉ" to "ノ",
            "ﾊ" to "ハ", "ﾋ" to "ヒ", "ﾌ" to "フ", "ﾍ" to "ヘ", "ﾎ" to "ホ",
            "ﾏ" to "マ", "ﾐ" to "ミ", "ﾑ" to "ム", "ﾒ" to "メ", "ﾓ" to "モ",
            "ﾔ" to "ヤ", "ﾕ" to "ユ", "ﾖ" to "ヨ",
            "ﾗ" to "ラ", "ﾘ" to "リ", "ﾙ" to "ル", "ﾚ" to "レ", "ﾛ" to "ロ",
            "ﾜ" to "ワ", "ｦ" to "ヲ", "ﾝ" to "ン",
            "ｧ" to "ァ", "ｨ" to "ィ", "ｩ" to "ゥ", "ｪ" to "ェ", "ｫ" to "ォ",
            "ｯ" to "ッ", "ｬ" to "ャ", "ｭ" to "ュ", "ｮ" to "ョ",
            "｡" to "。", "｢" to "「", "｣" to "」", "､" to "、", "･" to "・",
            "ｰ" to "ー"
        )
        for ((k, v) in kanaMap) {
            s = s.replace(k, v)
        }
        return s.lowercase()
            .map { ch ->
                // 全角英数字 → 半角
                if (ch in 'Ａ'..'Ｚ' || ch in 'ａ'..'ｚ' || ch in '０'..'９') {
                    (ch.code - 0xFEE0).toChar()
                } else ch
            }.joinToString("")
            .replace(Regex("[.\\-＿_\\s　]"), "")
    }

    // クレジットカード明細とショッピング注文履歴の突合マッチング
    fun matchCardAndShopping(
        cardTransactions: List<ImportedTransaction>,
        shoppingTransactions: List<ImportedTransaction>,
        keywords: List<String>
    ): List<ImportedTransaction> {
        val result = mutableListOf<ImportedTransaction>()
        val targetCardTxs = mutableListOf<ImportedTransaction>()
        for (cardTx in cardTransactions) {
            val isTarget = keywords.any { kw -> cardTx.description.uppercase().contains(kw.uppercase()) }
            if (isTarget) targetCardTxs.add(cardTx) else result.add(cardTx)
        }
        val availableOrders = shoppingTransactions.toMutableList()
        val matchedOrderIndices = mutableSetOf<Int>()
        fun getOrderId(tx: ImportedTransaction): String {
            return tx.rawData["col9"] ?: tx.rawData["orderId"] ?: ""
        }
        val ordersByOrderId = mutableMapOf<String, MutableList<Int>>()
        availableOrders.forEachIndexed { idx, tx ->
            val orderId = getOrderId(tx)
            if (orderId.isEmpty()) return@forEachIndexed
            ordersByOrderId.getOrPut(orderId) { mutableListOf() }.add(idx)
        }
        val unmatchedCardTxs = mutableListOf<ImportedTransaction>()
        for (cardTx in targetCardTxs) {
            var bestMatchIdx = -1
            var minDateDiff = Double.MAX_VALUE
            for (i in availableOrders.indices) {
                if (i in matchedOrderIndices) continue
                val orderTx = availableOrders[i]
                if (Math.abs((cardTx.amount - orderTx.amount).toDouble()) < 0.01) {
                    val diffDays = Math.abs(cardTx.date.toEpochDay() - orderTx.date.toEpochDay()).toDouble()
                    if (diffDays <= 7 && diffDays < minDateDiff) {
                        minDateDiff = diffDays
                        bestMatchIdx = i
                    }
                }
            }
            if (bestMatchIdx != -1) {
                matchedOrderIndices.add(bestMatchIdx)
                val orderTx = availableOrders[bestMatchIdx]
                result.add(cardTx.copy(description = orderTx.description))
            } else {
                unmatchedCardTxs.add(cardTx)
            }
        }
        val finalUnmatched = mutableListOf<ImportedTransaction>()
        for (cardTx in unmatchedCardTxs) {
            var bestOrderId = ""
            var minDateDiff = Double.MAX_VALUE
            for ((orderId, indices) in ordersByOrderId) {
                if (indices.any { it in matchedOrderIndices }) continue
                val groupTotal = indices.sumOf { availableOrders[it].amount }
                if (Math.abs((cardTx.amount - groupTotal).toDouble()) < 0.01) {
                    val orderDate = availableOrders[indices[0]].date
                    val diffDays = Math.abs(cardTx.date.toEpochDay() - orderDate.toEpochDay()).toDouble()
                    if (diffDays <= 7 && diffDays < minDateDiff) {
                        minDateDiff = diffDays
                        bestOrderId = orderId
                    }
                }
            }
            if (bestOrderId.isNotEmpty()) {
                val indices = ordersByOrderId[bestOrderId]!!
                indices.forEach { matchedOrderIndices.add(it) }
                indices.forEach { idx ->
                    val orderTx = availableOrders[idx]
                    result.add(cardTx.copy(description = orderTx.description, amount = orderTx.amount))
                }
            } else {
                finalUnmatched.add(cardTx)
            }
        }
        result.addAll(finalUnmatched)
        return result.sortedBy { it.date }
    }
}
