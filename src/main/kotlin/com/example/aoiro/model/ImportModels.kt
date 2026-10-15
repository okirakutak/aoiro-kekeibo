package com.example.aoiro.model

import java.time.LocalDate

// シートレイアウト種別（excel-writer.service.ts の SheetLayout に対応）
enum class SheetLayout {
    BANK, CREDIT_CARD;

    companion object {
        fun fromString(raw: String?): SheetLayout? = when (raw?.lowercase()) {
            "bank" -> BANK
            "credit-card", "creditcard", "credit_card" -> CREDIT_CARD
            else -> null
        }
    }
}

// CSV列の指定方法（plugin-config.ts の ColumnSpec に対応）
// 単一列 {index} または複数列結合 {index[], join, format}
sealed class ColumnSpec {
    data class Single(val index: Int) : ColumnSpec()
    data class Joined(val indices: List<Int>, val join: String, val format: String? = null) : ColumnSpec()
}

data class CsvColumnsConfig(
    val date: ColumnSpec,
    val description: ColumnSpec,
    val income: ColumnSpec? = null,
    val expense: ColumnSpec? = null,
    val amount: ColumnSpec? = null,
    val category: ColumnSpec? = null,
    val balance: ColumnSpec? = null
)

data class HtmlSelectorsConfig(
    val row: String,
    val description: String,
    val amount: String,
    val dateText: String? = null,
    val dateAttr: String? = null,
    val orderId: String? = null
)

data class HtmlMergeConfig(
    val detailSelectors: HtmlSelectorsConfig,
    val matchKey: String = "orderId" // 'orderId' | 'date'
)

data class ConfigMappingRule(
    val keyword: String,
    val debitAccount: String,
    val debitSubAccount: String? = null,
    val creditAccount: String? = null,
    val creditSubAccount: String? = null
)

data class TextPatterns(
    val blockSeparator: String,
    val date: String,
    val description: String,
    val amount: String,
    val orderId: String? = null
)

// JSON設定ファイルの全体構造（plugin-config.ts の PluginConfig に対応）
data class PluginConfig(
    val id: String,
    val name: String,
    val description: String = "",
    val format: String = "csv", // 'csv' | 'html' | 'text'
    val encoding: String = "UTF-8",
    val supportedExtensions: List<String> = listOf("csv"),
    val multiFile: Boolean = false,
    val delimiter: String = ",",
    val skipRows: Int = 0,
    val hasHeader: Boolean = true,
    val requireBalance: Boolean = false,
    val columns: CsvColumnsConfig? = null,
    val filterYear: Int? = null,
    val selectors: HtmlSelectorsConfig? = null,
    val htmlMerge: HtmlMergeConfig? = null,
    val datePattern: String? = null,
    val amountPattern: String? = null,
    val targetSheet: String = "",
    val sheetLayout: SheetLayout? = null,
    val hasOpeningBalance: Boolean? = null,
    val cutoffDay: Any? = null, // Int または "last"
    val paymentMonthOffset: Int? = null,
    val paymentDay: Any? = null, // Int または "last"
    val defaultDebitAccount: String = "",
    val defaultDebitSubAccount: String? = null,
    val defaultCreditAccount: String = "",
    val defaultCreditSubAccount: String? = null,
    val mappingRules: List<ConfigMappingRule> = emptyList(),
    val textPatterns: TextPatterns? = null,
    val type: String? = null // 'credit-card' | 'shopping' | 'bank' | 'sales'
)

// パース結果の中間データ（import-plugin.ts の ImportedTransaction に対応）
data class ImportedTransaction(
    val date: LocalDate,
    val description: String,
    val amount: Long,
    val category: String? = null, // '入金' | '出金'
    val paymentMethod: String? = null,
    val balance: Long? = null,
    val rawData: Map<String, String> = emptyMap(),
    // TSV直接生成など JournalEntry 形式で渡された場合の科目情報を保持
    val debitAccount: String? = null,
    val debitSubAccount: String? = null,
    val creditAccount: String? = null,
    val creditSubAccount: String? = null,
    val memo: String? = null
)

// インポート対象シート（excel.service.ts の ImportTargetSheet に対応）
data class ImportTargetSheet(
    val sheetName: String,
    val account: String,
    val subAccount: String? = null,
    val settleSheet: String? = null,
    val settleSub: String? = null,
    val keyword: String? = null,
    val searchKeywords: List<String>? = null,
    val hasJson: Boolean = false,
    val jsonConfig: PluginConfig? = null
)
