import * as fs from 'fs'
import { parse } from 'csv-parse/sync'
import * as iconv from 'iconv-lite'
import { v4 as uuidv4 } from 'uuid'
import { ImportPlugin, ImportedTransaction, MappingRule } from '../../src/types/import-plugin'
import { JournalEntry } from '../../src/types/accounting'

/**
 * 汎用銀行CSVインポートプラグイン
 *
 * 一般的な銀行のCSVフォーマットに対応。
 * Shift_JISエンコーディングのCSVをiconv-liteでUTF-8に変換して処理する。
 *
 * 想定CSVカラム: 日付, 摘要, 入金額(お預り金額), 出金額(お引出金額), 残高
 *
 * 仕訳ルール:
 *   入金の場合: 借方=普通預金, 貸方=売上高（デフォルト）
 *   出金の場合: 借方=消耗品費（デフォルト）, 貸方=普通預金
 */
export const genericBankCsvPlugin: ImportPlugin = {
  id: 'generic-bank-csv',
  name: '汎用銀行CSV',
  description: '一般的な銀行のCSVファイルをインポートします。Shift_JISエンコーディングに対応。',
  supportedExtensions: ['csv'],
  targetSheet: '銀行CSV',

  // デフォルトの仕訳設定
  defaultDebitAccount: '普通預金',
  defaultCreditAccount: '普通預金',

  /**
   * CSVファイルをパースして取引明細の配列を返す
   * Shift_JISエンコーディングをiconv-liteでUTF-8に変換してから処理
   * @param filePath CSVファイルのパス
   * @returns パース結果の取引明細配列
   */
  async parse(filePath: string): Promise<ImportedTransaction[]> {
    // ファイルをバイナリで読み込み、Shift_JISからUTF-8に変換
    const buffer = fs.readFileSync(filePath)
    const content = iconv.decode(buffer, 'Shift_JIS')

    // csv-parseの同期版でパース
    const records: Record<string, string>[] = parse(content, {
      columns: true,       // ヘッダー行を列名として使用
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true  // カラム数のずれを許容
    })

    const transactions: ImportedTransaction[] = []

    for (const record of records) {
      // 日付の取得（複数の列名パターンに対応）
      const dateStr = record['日付'] || record['取引日'] || record['お取引日'] || record['年月日'] || ''
      if (!dateStr) continue

      // 摘要の取得
      const description = record['摘要'] || record['お取引内容'] || record['取引内容'] || record['適用'] || ''

      // 入金額・出金額の取得
      const depositStr = record['入金額'] || record['お預り金額'] || record['入金'] || record['預入金額'] || ''
      const withdrawStr = record['出金額'] || record['お引出金額'] || record['出金'] || record['引出金額'] || ''

      const depositAmount = parseAmount(depositStr)
      const withdrawAmount = parseAmount(withdrawStr)

      // 入金も出金もない場合はスキップ
      if (depositAmount === 0 && withdrawAmount === 0) continue

      // 入金の場合は正の金額、出金の場合は負の金額として記録
      // amountフィールドには絶対値を格納し、rawDataで入出金の区別を保持
      const isDeposit = depositAmount > 0
      const amount = isDeposit ? depositAmount : withdrawAmount

      transactions.push({
        date: parseDate(dateStr),
        description: description || (isDeposit ? '入金' : '出金'),
        amount,
        paymentMethod: isDeposit ? '入金' : '出金',
        rawData: { ...record }
      })
    }

    return transactions
  },

  /**
   * 取引明細を仕訳データに変換する
   *
   * 入金の場合: 借方=普通預金, 貸方=売上高（またはマッピングルールで判定）
   * 出金の場合: 借方=消耗品費（またはマッピングルールで判定）, 貸方=普通預金
   *
   * @param transactions 取引明細の配列
   * @param mappingRules 科目マッピングルール（任意）
   * @returns 仕訳データの配列
   */
  toJournalEntries(
    transactions: ImportedTransaction[],
    mappingRules?: MappingRule[]
  ): JournalEntry[] {
    return transactions.map(tx => {
      const isDeposit = tx.paymentMethod === '入金'

      // デフォルト科目を設定
      let debitAccount: string
      let debitSubAccount: string | undefined = undefined
      let creditAccount: string
      let creditSubAccount: string | undefined = undefined

      if (isDeposit) {
        // 入金: 借方=普通預金, 貸方=売上高（デフォルト）
        debitAccount = '普通預金'
        creditAccount = '売上高'
      } else {
        // 出金: 借方=消耗品費（デフォルト）, 貸方=普通預金
        debitAccount = '消耗品費'
        creditAccount = '普通預金'
      }

      // マッピングルールがある場合、キーワードマッチで科目を判定
      if (mappingRules && mappingRules.length > 0) {
        const matchedRule = mappingRules.find(rule =>
          tx.description.includes(rule.keyword)
        )
        if (matchedRule) {
          if (isDeposit) {
            // 入金時: マッピングルールで貸方科目を上書き
            if (matchedRule.creditAccount) {
              creditAccount = matchedRule.creditAccount
            }
            creditSubAccount = matchedRule.creditSubAccount
            // 借方もルールで指定があれば上書き
            if (matchedRule.debitAccount) {
              debitAccount = matchedRule.debitAccount
            }
            debitSubAccount = matchedRule.debitSubAccount
          } else {
            // 出金時: マッピングルールで借方科目を上書き
            debitAccount = matchedRule.debitAccount
            debitSubAccount = matchedRule.debitSubAccount
            // 貸方もルールで指定があれば上書き
            if (matchedRule.creditAccount) {
              creditAccount = matchedRule.creditAccount
            }
            creditSubAccount = matchedRule.creditSubAccount
          }
        }
      }

      return {
        id: uuidv4(),
        date: tx.date,
        debitAccount,
        debitSubAccount,
        creditAccount,
        creditSubAccount,
        amount: tx.amount,
        description: tx.description,
        sourceSheet: '銀行CSV'
      }
    })
  }
}

/**
 * 日付文字列をDateオブジェクトに変換する
 * 対応フォーマット: YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月DD日, YYYYMMDD
 */
function parseDate(dateStr: string): Date {
  // 年月日形式を正規化
  const normalized = dateStr
    .replace(/年|月/g, '/')
    .replace(/日/g, '')
    .trim()

  // YYYYMMDD形式（区切り文字なし）
  if (/^\d{8}$/.test(normalized)) {
    const year = parseInt(normalized.substring(0, 4), 10)
    const month = parseInt(normalized.substring(4, 6), 10) - 1
    const day = parseInt(normalized.substring(6, 8), 10)
    return new Date(year, month, day)
  }

  // YYYY/MM/DD または YYYY-MM-DD
  const parts = normalized.split(/[\/\-]/)
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10) - 1 // Dateの月は0始まり
    const day = parseInt(parts[2], 10)
    return new Date(year, month, day)
  }

  // フォールバック: そのままパース
  return new Date(dateStr)
}

/**
 * 金額文字列を数値に変換する
 * 円マーク(¥, ￥)、カンマ、スペースを除去して数値化
 * 空文字列の場合は0を返す
 */
function parseAmount(amountStr: string): number {
  if (!amountStr || amountStr.trim() === '') return 0
  const cleaned = amountStr
    .replace(/[¥￥,、\s]/g, '')
    .trim()
  if (cleaned === '' || cleaned === '-') return 0
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : Math.abs(num)
}
