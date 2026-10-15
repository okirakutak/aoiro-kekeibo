package com.example.aoiro.model

import java.text.NumberFormat
import java.util.Locale

data class AccountLedger(
    val accountName: String,
    val subAccountName: String? = null,
    val entries: MutableList<LedgerEntry> = mutableListOf(),
    var openingBalance: Long = 0L,
    var totalDebit: Long = 0L,
    var totalCredit: Long = 0L,
    var closingBalance: Long = 0L
) {
    val ledgerKey: String
        get() = if (!subAccountName.isNullOrEmpty()) "$accountName::$subAccountName" else accountName

    val displayName: String
        get() {
            val numFmt = NumberFormat.getNumberInstance(Locale.JAPAN)
            val balStr = numFmt.format(closingBalance)
            return if (subAccountName.isNullOrEmpty()) {
                "📁 $accountName (すべて) - 残高: $balStr"
            } else {
                "　└ $subAccountName - 残高: $balStr"
            }
        }
}
