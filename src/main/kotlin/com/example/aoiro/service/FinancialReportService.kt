package com.example.aoiro.service

import com.example.aoiro.model.AccountLedger
import com.example.aoiro.model.BSData
import com.example.aoiro.model.PLData

object FinancialReportService {

    /**
     * 損益計算書データを生成する。
     * 分類は勘定科目マスタの種別（収益・費用）を優先し、
     * マスタ未登録の科目のみ従来の名称判定にフォールバックする。
     * 合計は符号通り（費用=残高合計、収益=-残高合計）に集計し、
     * 貸方超過などで符号が反転した科目があっても貸借が一致するようにする。
     */
    fun generatePL(
        ledgers: List<AccountLedger>,
        accountTypes: Map<String, String>? = null
    ): PLData {
        // 親（全体合算）のみを対象とする
        val parents = ledgers.filter { it.subAccountName.isNullOrEmpty() }

        val expenses = parents.filter { l ->
            val type = accountTypes?.get(l.accountName)
            if (type != null) type == "費用" else isExpenseName(l.accountName)
        }

        val revenues = parents.filter { l ->
            val type = accountTypes?.get(l.accountName)
            if (type != null) type == "収益" else isRevenueName(l.accountName)
        }

        val totalExpense = expenses.sumOf { it.closingBalance }
        val totalRevenue = revenues.sumOf { -it.closingBalance }
        val netIncome = totalRevenue - totalExpense

        return PLData(
            expenses = expenses,
            revenues = revenues,
            totalExpense = totalExpense,
            totalRevenue = totalRevenue,
            netIncome = netIncome
        )
    }

    /**
     * 貸借対照表データを生成する。
     * 分類は勘定科目マスタの種別（資産・負債・資本）を優先し、
     * マスタ未登録の科目のみ従来の名称判定にフォールバックする。
     * 資本（元入金・事業主借）は従来通り負債・資本側に表示する。
     * 合計は符号通り（資産=残高合計、負債・資本側=-残高合計）に集計する。
     */
    fun generateBS(
        ledgers: List<AccountLedger>,
        netIncome: Long,
        accountTypes: Map<String, String>? = null
    ): BSData {
        val parents = ledgers.filter { it.subAccountName.isNullOrEmpty() }

        val assets = parents.filter { l ->
            val type = accountTypes?.get(l.accountName)
            if (type != null) type == "資産" else isAssetName(l.accountName)
        }

        val liabilities = parents.filter { l ->
            val type = accountTypes?.get(l.accountName)
            if (type != null) type == "負債" || type == "資本" else isLiabilityName(l.accountName)
        }

        val totalAssets = assets.sumOf { it.closingBalance }
        val totalLiabilities = liabilities.sumOf { -it.closingBalance }

        return BSData(
            assets = assets,
            liabilities = liabilities,
            totalAssets = totalAssets,
            totalLiabilities = totalLiabilities,
            netIncome = netIncome
        )
    }

    // マスタ未登録科目用の名称判定（従来ロジックを維持）
    private fun isExpenseName(name: String): Boolean {
        return name.endsWith("費") || name.endsWith("料") ||
            name == "租税公課" || name == "減価償却費" || name == "支払手数料" || name == "雑費"
    }

    private fun isRevenueName(name: String): Boolean {
        return name == "売上高" || name == "雑収入" || name.contains("収入") || name.contains("売上")
    }

    private fun isAssetName(name: String): Boolean {
        return name == "現金" || name == "普通預金" || name == "売掛金" || name == "事業主貸" ||
            name == "敷金" || name == "車両運搬具" || name.contains("預金") || name.contains("資産")
    }

    private fun isLiabilityName(name: String): Boolean {
        return name == "未払金" || name == "買掛金" || name == "借入金" ||
            name == "事業主借" || name == "元入金" || name == "預り金"
    }
}
