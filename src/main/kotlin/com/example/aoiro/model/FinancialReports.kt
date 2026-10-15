package com.example.aoiro.model

data class PLData(
    val expenses: List<AccountLedger>,
    val revenues: List<AccountLedger>,
    val totalExpense: Long,
    val totalRevenue: Long,
    val netIncome: Long
) {
    val expenseRows: List<ReportRow>
        get() {
            val list = expenses.map { ReportRow(it.accountName, it.closingBalance) }.toMutableList()
            if (netIncome > 0) {
                list.add(ReportRow("当期純利益", netIncome, isProfitLossHighlight = true, isProfit = true))
            }
            return list
        }

    val revenueRows: List<ReportRow>
        get() {
            val list = revenues.map { ReportRow(it.accountName, -it.closingBalance) }.toMutableList()
            if (netIncome < 0) {
                list.add(ReportRow("当期純損失", Math.abs(netIncome), isProfitLossHighlight = true, isProfit = false))
            }
            return list
        }

    val finalExpenseTotal: Long
        get() = totalExpense + (if (netIncome > 0) netIncome else 0L)

    val finalRevenueTotal: Long
        get() = totalRevenue + (if (netIncome < 0) Math.abs(netIncome) else 0L)
}

data class BSData(
    val assets: List<AccountLedger>,
    val liabilities: List<AccountLedger>,
    val totalAssets: Long,
    val totalLiabilities: Long,
    val netIncome: Long
) {
    val assetRows: List<ReportRow>
        get() = assets.map { ReportRow(it.accountName, it.closingBalance) }

    val liabilityRows: List<ReportRow>
        get() {
            val list = liabilities.map { ReportRow(it.accountName, -it.closingBalance) }.toMutableList()
            list.add(ReportRow("当期純利益", netIncome, isProfitLossHighlight = true, isProfit = netIncome >= 0))
            return list
        }

    val finalAssetTotal: Long
        get() = totalAssets

    val finalLiabilityTotal: Long
        get() = totalLiabilities + netIncome
}
