import * as fs from 'fs'
import { parse } from 'csv-parse/sync'
import { v4 as uuidv4 } from 'uuid'
import { ImportPlugin, ImportedTransaction, MappingRule } from '../../src/types/import-plugin'
import { JournalEntry } from '../../src/types/accounting'

/**
 * Amazon注文履歴CSVインポートプラグイン
 *
 * Amazon Japanの注文履歴CSVフォーマットに対応。
 * UTF-8（BOM付きの場合も対応）でエンコードされたCSVを読み込み、
 * 注文日・商品名・金額から仕訳データを生成する。
 *
 * 想定CSVカラム: 注文日, 注文番号, 商品名, カテゴリー, 数量, 商品小計, ...
 */
export const amazonCsvPlugin: ImportPlugin = {
  id: 'amazon-csv',
  name: 'Amazon 注文履歴',
  description: 'Amazon Japanの注文履歴CSVファイルをインポートします。UTF-8エンコーディングに対応。',
  supportedExtensions: ['csv'],
  targetSheet: 'Amazon',

  // デフォルトの仕訳設定
  defaultDebitAccount: '消耗品費',
  defaultCreditAccount: '未払金',

  /**
   * CSVファイルをパースして取引明細の配列を返す
   * @param filePath CSVファイルのパス
   * @returns パース結果の取引明細配列
   */
  async parse(filePath: string): Promise<ImportedTransaction[]> {
    // ファイルをUTF-8で読み込み
    let content = fs.readFileSync(filePath, 'utf-8')

    // BOM（Byte Order Mark）がある場合は除去
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1)
    }

    // csv-parseの同期版でパース
    const records: Record<string, string>[] = parse(content, {
      columns: true,       // ヘッダー行を列名として使用
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true  // カラム数のずれを許容
    })

    const transactions: ImportedTransaction[] = []

    for (const record of records) {
      // 注文日の取得（複数の列名パターンに対応）
      const dateStr = record['注文日'] || record['日付'] || record['Order Date'] || ''
      if (!dateStr) continue

      // 商品名の取得
      const description = record['商品名'] || record['品名'] || record['Product Name'] || ''
      if (!description) continue

      // 金額の取得（円マーク・カンマを除去して数値化）
      const amountStr = record['商品小計'] || record['合計'] || record['金額'] || record['Price'] || '0'
      const amount = parseAmount(amountStr)
      if (amount <= 0) continue

      // カテゴリーの取得
      const category = record['カテゴリー'] || record['Category'] || undefined

      transactions.push({
        date: parseDate(dateStr),
        description,
        amount,
        category,
        rawData: { ...record }
      })
    }

    return transactions
  },

  /**
   * 取引明細を仕訳データに変換する
   * MappingRuleが指定されている場合、摘要のキーワードマッチで科目を判定する
   * @param transactions 取引明細の配列
   * @param mappingRules 科目マッピングルール（任意）
   * @returns 仕訳データの配列
   */
  toJournalEntries(
    transactions: ImportedTransaction[],
    mappingRules?: MappingRule[]
  ): JournalEntry[] {
    return transactions.map(tx => {
      // デフォルト科目を設定
      let debitAccount = this.defaultDebitAccount
      let debitSubAccount: string | undefined = undefined
      let creditAccount = this.defaultCreditAccount
      let creditSubAccount: string | undefined = this.defaultCreditSubAccount

      // マッピングルールがある場合、キーワードマッチで科目を判定
      if (mappingRules && mappingRules.length > 0) {
        const matchedRule = mappingRules.find(rule =>
          tx.description.includes(rule.keyword)
        )
        if (matchedRule) {
          debitAccount = matchedRule.debitAccount
          debitSubAccount = matchedRule.debitSubAccount
          if (matchedRule.creditAccount) {
            creditAccount = matchedRule.creditAccount
          }
          creditSubAccount = matchedRule.creditSubAccount ?? creditSubAccount
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
        sourceSheet: 'Amazon'
      }
    })
  }
}

/**
 * 日付文字列をDateオブジェクトに変換する
 * 対応フォーマット: YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月DD日
 */
function parseDate(dateStr: string): Date {
  // 年月日形式を正規化
  const normalized = dateStr
    .replace(/年|月/g, '/')
    .replace(/日/g, '')
    .trim()

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
 */
function parseAmount(amountStr: string): number {
  const cleaned = amountStr
    .replace(/[¥￥,、\s]/g, '')
    .trim()
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : Math.abs(num)
}
