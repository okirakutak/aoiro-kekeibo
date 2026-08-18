import * as fs from 'fs'
import * as iconv from 'iconv-lite'
import { v4 as uuidv4 } from 'uuid'
import { JournalEntry, TrialBalanceEntry } from '../../src/types/accounting'

// Shift-JISのテキストファイルを読み込んでUTF-8文字列に変換する
function readShiftJIS(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return iconv.decode(buffer, 'Shift_JIS')
}

// タブ区切りの行をパースし、ダブルクォートを除去する
function parseTSVLine(line: string): string[] {
  return line.split('\t').map(cell => {
    // ダブルクォートで囲まれている場合は除去
    const trimmed = cell.trim()
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  })
}

// やよいの仕訳日記帳（txt）をインポートする
export function importYayoiJournal(filePath: string): JournalEntry[] {
  const content = readShiftJIS(filePath)
  const lines = content.split(/\r?\n/)
  const entries: JournalEntry[] = []

  for (const line of lines) {
    if (!line.trim()) continue

    const cols = parseTSVLine(line)

    // [明細行] のみを処理（[日次合計行]や[合計行]はスキップ）
    if (cols[0] !== '[明細行]') continue

    const dateStr = cols[1]         // 日付
    const debitAcc = cols[9]        // 借方勘定科目
    const debitSub = cols[10]       // 借方補助科目
    const debitAmtStr = cols[14]    // 借方金額
    const creditAcc = cols[16]      // 貸方勘定科目
    const creditSub = cols[17]      // 貸方補助科目
    const description = cols[23]    // 摘要

    // 日付と科目と金額が揃っていない行はスキップ
    if (!dateStr || !debitAcc || !debitAmtStr) continue

    const amount = parseInt(debitAmtStr.replace(/,/g, ''), 10)
    if (isNaN(amount)) continue

    entries.push({
      id: uuidv4(),
      date: new Date(dateStr),
      debitAccount: debitAcc,
      debitSubAccount: debitSub || undefined,
      creditAccount: creditAcc || '',
      creditSubAccount: creditSub || undefined,
      amount,
      description: description || '',
      note: '',
      sourceSheet: 'やよい仕訳日記帳'
    })
  }

  // 日付の昇順でソート
  return entries.sort((a, b) => a.date.getTime() - b.date.getTime())
}

// やよいの残高試算表（txt）をインポートする
export function importYayoiTrialBalance(filePath: string): TrialBalanceEntry[] {
  const content = readShiftJIS(filePath)
  const lines = content.split(/\r?\n/)
  const results: TrialBalanceEntry[] = []
  let currentClassification = '' // 現在のセクション（貸借対照表 or 損益計算書）

  for (const line of lines) {
    if (!line.trim()) continue

    const cols = parseTSVLine(line)

    // [区分行] でセクション変更を追跡
    if (cols[0] === '[区分行]') {
      // cols[2] は [貸借対照表] や [損益計算書] のような値
      if (cols[2]) {
        // 角括弧を除去して保持
        currentClassification = cols[2].replace(/[[\]]/g, '')
      }
      continue
    }

    // [明細行] のみを処理
    if (cols[0] !== '[明細行]') continue

    const accountName = cols[3]
    // 最終列（当期残高(合計)）を取得（列インデックス20）
    const balanceStr = cols[20]

    if (!accountName || balanceStr === undefined) continue

    const balance = parseInt(balanceStr.replace(/,/g, ''), 10)
    if (isNaN(balance)) continue

    results.push({
      classification: currentClassification,
      accountName,
      annualBalance: balance
    })
  }

  return results
}
