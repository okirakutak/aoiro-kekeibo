package com.example.aoiro.model

import java.time.LocalDate

data class LedgerEntry(
    val date: LocalDate?,
    val opponentAccount: String,
    val opponentSubAccount: String? = null,
    val description: String,
    val debitAmount: Long,
    val creditAmount: Long,
    val balance: Long
) {
    val opponentFormatted: String
        get() = if (!opponentSubAccount.isNullOrEmpty()) "$opponentAccount ($opponentSubAccount)" else opponentAccount
}
