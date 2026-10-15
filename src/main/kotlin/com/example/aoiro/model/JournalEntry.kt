package com.example.aoiro.model

import java.time.LocalDate

data class JournalEntry(
    val id: String,
    val date: LocalDate,
    val debitAccount: String,
    val debitSubAccount: String? = null,
    val creditAccount: String,
    val creditSubAccount: String? = null,
    val amount: Long,
    val description: String,
    val note: String? = null,
    val sourceSheet: String
) {
    val debitFormatted: String
        get() = if (!debitSubAccount.isNull_or_empty()) "$debitAccount ($debitSubAccount)" else debitAccount

    val creditFormatted: String
        get() = if (!creditSubAccount.isNull_or_empty()) "$creditAccount ($creditSubAccount)" else creditAccount
}

private fun String?.isNull_or_empty(): Boolean = this == null || this.trim().isEmpty()
