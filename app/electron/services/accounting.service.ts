import { JournalEntry, AccountLedger, Account } from '../../src/types/accounting'

// 勘定科目キーを生成する（大元と補助科目を表現）
function getLedgerKey(account: string, subAccount?: string) {
  return subAccount ? `${account}::${subAccount}` : account
}

// 勘定科目マスタから科目の分類を取得する
function getAccountType(accountName: string, accounts: Account[]): Account['type'] | null {
  const found = accounts.find(a => a.name === accountName)
  return found ? found.type : null
}

export function generateLedgers(entries: JournalEntry[]): AccountLedger[] {
  const ledgerMap = new Map<string, AccountLedger>()

  const getOrCreateLedger = (accountName: string, subAccountName?: string) => {
    const key = getLedgerKey(accountName, subAccountName)
    if (!ledgerMap.has(key)) {
      ledgerMap.set(key, {
        accountName,
        subAccountName,
        entries: [],
        openingBalance: 0,
        totalDebit: 0,
        totalCredit: 0,
        closingBalance: 0
      })
    }
    return ledgerMap.get(key)!
  }

  // 前期繰越エントリと通常エントリを分離
  const openingEntries = entries.filter(e => e.description === '前期繰越')
  const regularEntries = entries.filter(e => e.description !== '前期繰越')

  // --- 1. 前期繰越エントリを処理して openingBalance を設定 ---
  for (const entry of openingEntries) {
    if (!entry.debitAccount || !entry.creditAccount) continue

    // 借方側: openingBalance を加算
    const setOpeningDebit = (ledger: AccountLedger) => {
      ledger.openingBalance += entry.amount
      ledger.closingBalance = ledger.openingBalance
    }
    // 貸方側: openingBalance を減算
    const setOpeningCredit = (ledger: AccountLedger) => {
      ledger.openingBalance -= entry.amount
      ledger.closingBalance = ledger.openingBalance
    }

    setOpeningDebit(getOrCreateLedger(entry.debitAccount))
    if (entry.debitSubAccount) {
      setOpeningDebit(getOrCreateLedger(entry.debitAccount, entry.debitSubAccount))
    }
    setOpeningCredit(getOrCreateLedger(entry.creditAccount))
    if (entry.creditSubAccount) {
      setOpeningCredit(getOrCreateLedger(entry.creditAccount, entry.creditSubAccount))
    }
  }

  // --- 2. 通常エントリを処理（残高は openingBalance を起点に累積） ---
  for (const entry of regularEntries) {
    if (!entry.debitAccount || !entry.creditAccount) continue

    // 借方側の処理
    const processDebit = (ledger: AccountLedger) => {
      ledger.totalDebit += entry.amount
      ledger.closingBalance = ledger.openingBalance + ledger.totalDebit - ledger.totalCredit
      ledger.entries.push({
        date: entry.date,
        opponentAccount: entry.creditAccount,
        opponentSubAccount: entry.creditSubAccount,
        description: entry.description,
        debitAmount: entry.amount,
        creditAmount: 0,
        balance: ledger.closingBalance
      })
    }

    // 貸方側の処理
    const processCredit = (ledger: AccountLedger) => {
      ledger.totalCredit += entry.amount
      ledger.closingBalance = ledger.openingBalance + ledger.totalDebit - ledger.totalCredit
      ledger.entries.push({
        date: entry.date,
        opponentAccount: entry.debitAccount,
        opponentSubAccount: entry.debitSubAccount,
        description: entry.description,
        debitAmount: 0,
        creditAmount: entry.amount,
        balance: ledger.closingBalance
      })
    }

    // 借方 (全体合算用)
    processDebit(getOrCreateLedger(entry.debitAccount))
    // 借方 (補助科目用)
    if (entry.debitSubAccount) {
      processDebit(getOrCreateLedger(entry.debitAccount, entry.debitSubAccount))
    }

    // 貸方 (全体合算用)
    processCredit(getOrCreateLedger(entry.creditAccount))
    // 貸方 (補助科目用)
    if (entry.creditSubAccount) {
      processCredit(getOrCreateLedger(entry.creditAccount, entry.creditSubAccount))
    }
  }

  // 大元の科目ごとに整理しやすくするため、配列化してソート
  return Array.from(ledgerMap.values()).sort((a, b) => {
    if (a.accountName !== b.accountName) return a.accountName.localeCompare(b.accountName)
    if (!a.subAccountName) return -1 // 親（すべて）が先
    if (!b.subAccountName) return 1
    return a.subAccountName.localeCompare(b.subAccountName)
  })
}

// 損益計算書の生成（勘定科目マスタを使った動的分類）
export function generatePL(ledgers: AccountLedger[], accounts: Account[] = []) {
  const parents = ledgers.filter(l => !l.subAccountName)
  
  // マスタから分類を取得して振り分け
  const expenses = parents.filter(l => {
    const type = getAccountType(l.accountName, accounts)
    if (type === '費用') return true
    // マスタに無い場合はフォールバック（科目名で推定）
    if (!type) return l.accountName.endsWith('費') || l.accountName.endsWith('料') || 
      l.accountName === '租税公課' || l.accountName === '減価償却費'
    return false
  })
  
  const revenues = parents.filter(l => {
    const type = getAccountType(l.accountName, accounts)
    if (type === '収益') return true
    if (!type) return l.accountName === '売上高' || l.accountName === '雑収入'
    return false
  })
  
  // closingBalance は「借方 - 貸方」で統一されている
  const totalExpense = expenses.reduce((sum, l) => sum + Math.abs(l.closingBalance), 0)
  const totalRevenue = revenues.reduce((sum, l) => sum + Math.abs(l.closingBalance), 0)
  
  return {
    expenses,
    revenues,
    totalExpense,
    totalRevenue,
    netIncome: totalRevenue - totalExpense
  }
}

// 貸借対照表の生成（勘定科目マスタを使った動的分類）
export function generateBS(ledgers: AccountLedger[], netIncome: number, accounts: Account[] = []) {
  const parents = ledgers.filter(l => !l.subAccountName)
  
  const assets = parents.filter(l => {
    const type = getAccountType(l.accountName, accounts)
    if (type === '資産') return true
    if (!type) return l.accountName === '現金' || l.accountName === '普通預金' || 
      l.accountName === '売掛金' || l.accountName === '事業主貸'
    return false
  })
  
  const liabilities = parents.filter(l => {
    const type = getAccountType(l.accountName, accounts)
    if (type === '負債' || type === '資本') return true
    if (!type) return l.accountName === '未払金' || l.accountName === '借入金' || 
      l.accountName === '事業主借' || l.accountName === '元入金'
    return false
  })
  
  // 資産: closingBalance = 借方 - 貸方（正が正常）
  const totalAssets = assets.reduce((sum, l) => sum + l.closingBalance, 0)
  // 負債: closingBalance = 借方 - 貸方（負が正常なので絶対値にする）
  const totalLiabilities = liabilities.reduce((sum, l) => sum + Math.abs(l.closingBalance), 0)
  
  return {
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netIncome
  }
}
