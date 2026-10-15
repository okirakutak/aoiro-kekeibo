package com.example.aoiro.service

import com.example.aoiro.model.AccountLedger
import com.example.aoiro.model.JournalEntry
import com.example.aoiro.model.LedgerEntry

object LedgerService {

    fun generateLedgers(
        entries: List<JournalEntry>,
        accountOrder: List<String>? = null
    ): List<AccountLedger> {
        val ledgerMap = mutableMapOf<String, AccountLedger>()

        fun getOrCreateLedger(accountName: String, subAccountName: String? = null): AccountLedger {
            val subName = if (subAccountName.isNullOrEmpty()) null else subAccountName
            val key = if (subName != null) "$accountName::$subName" else accountName
            return ledgerMap.getOrPut(key) {
                AccountLedger(
                    accountName = accountName,
                    subAccountName = subName
                )
            }
        }

        // 前期繰越エントリと通常エントリを分離
        val openingEntries = entries.filter { it.description == "前期繰越" }
        val regularEntries = entries.filter { it.description != "前期繰越" }

        // 1. 前期繰越エントリを処理して openingBalance を設定
        for (entry in openingEntries) {
            if (entry.debitAccount.isEmpty() || entry.creditAccount.isEmpty()) continue

            // 借方側: openingBalance を加算
            val setOpeningDebit = { ledger: AccountLedger ->
                ledger.openingBalance += entry.amount
                ledger.closingBalance = ledger.openingBalance
            }
            // 貸方側: openingBalance を減算
            val setOpeningCredit = { ledger: AccountLedger ->
                ledger.openingBalance -= entry.amount
                ledger.closingBalance = ledger.openingBalance
            }

            setOpeningDebit(getOrCreateLedger(entry.debitAccount))
            if (!entry.debitSubAccount.isNullOrEmpty()) {
                setOpeningDebit(getOrCreateLedger(entry.debitAccount, entry.debitSubAccount))
            }
            setOpeningCredit(getOrCreateLedger(entry.creditAccount))
            if (!entry.creditSubAccount.isNullOrEmpty()) {
                setOpeningCredit(getOrCreateLedger(entry.creditAccount, entry.creditSubAccount))
            }
        }

        // 2. 通常エントリを処理（残高は openingBalance を起点に累積）
        for (entry in regularEntries) {
            if (entry.debitAccount.isEmpty() || entry.creditAccount.isEmpty()) continue

            // 借方側の処理
            val processDebit = { ledger: AccountLedger ->
                ledger.totalDebit += entry.amount
                ledger.closingBalance = ledger.openingBalance + ledger.totalDebit - ledger.totalCredit
                ledger.entries.add(
                    LedgerEntry(
                        date = entry.date,
                        opponentAccount = entry.creditAccount,
                        opponentSubAccount = entry.creditSubAccount,
                        description = entry.description,
                        debitAmount = entry.amount,
                        creditAmount = 0L,
                        balance = ledger.closingBalance
                    )
                )
            }

            // 貸方側の処理
            val processCredit = { ledger: AccountLedger ->
                ledger.totalCredit += entry.amount
                ledger.closingBalance = ledger.openingBalance + ledger.totalDebit - ledger.totalCredit
                ledger.entries.add(
                    LedgerEntry(
                        date = entry.date,
                        opponentAccount = entry.debitAccount,
                        opponentSubAccount = entry.debitSubAccount,
                        description = entry.description,
                        debitAmount = 0L,
                        creditAmount = entry.amount,
                        balance = ledger.closingBalance
                    )
                )
            }

            // 借方 (全体合算用)
            processDebit(getOrCreateLedger(entry.debitAccount))
            // 借方 (補助科目用)
            if (!entry.debitSubAccount.isNullOrEmpty()) {
                processDebit(getOrCreateLedger(entry.debitAccount, entry.debitSubAccount))
            }

            // 貸方 (全体合算用)
            processCredit(getOrCreateLedger(entry.creditAccount))
            // 貸方 (補助科目用)
            if (!entry.creditSubAccount.isNullOrEmpty()) {
                processCredit(getOrCreateLedger(entry.creditAccount, entry.creditSubAccount))
            }
        }

        // 大元の科目ごとに整理しやすくするため、リスト化してソート
        // accountOrder が指定された場合は勘定科目シートの id 順を優先し、
        // 未登録の科目は末尾に名前順で配置する
        val orderIndex = accountOrder
            ?.mapIndexed { index, name -> name to index }
            ?.toMap() ?: emptyMap()
        return ledgerMap.values.sortedWith(Comparator { a, b ->
            val aOrder = orderIndex[a.accountName] ?: Int.MAX_VALUE
            val bOrder = orderIndex[b.accountName] ?: Int.MAX_VALUE
            if (aOrder != bOrder) {
                aOrder.compareTo(bOrder)
            } else if (a.accountName != b.accountName) {
                a.accountName.compareTo(b.accountName)
            } else {
                when {
                    a.subAccountName == null -> -1 // 親（すべて）が先
                    b.subAccountName == null -> 1
                    else -> a.subAccountName.compareTo(b.subAccountName)
                }
            }
        })
    }
}
