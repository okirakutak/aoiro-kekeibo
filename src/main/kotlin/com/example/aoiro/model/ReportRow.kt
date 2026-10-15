package com.example.aoiro.model

data class ReportRow(
    val accountName: String,
    val amount: Long,
    val isProfitLossHighlight: Boolean = false,
    val isProfit: Boolean = true
)
