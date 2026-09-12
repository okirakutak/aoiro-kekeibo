/**
 * 汎用パーサーエンジン
 * JSON設定ファイルに基づいてCSV/HTMLファイルを解析し、
 * 統一された取引データ（ImportedTransaction）に変換する
 */
import * as fs from 'fs'
import * as path from 'path'
import * as iconv from 'iconv-lite'
import { parse as csvParse } from 'csv-parse/sync'
import * as cheerio from 'cheerio'
import { v4 as uuidv4 } from 'uuid'
import { convert } from 'html-to-text'
import { PluginConfig, ColumnSpec, HtmlSelectorsConfig } from '../../src/types/plugin-config'
import { ImportPlugin, ImportedTransaction, MappingRule } from '../../src/types/import-plugin'
import { JournalEntry } from '../../src/types/accounting'

/**
 * ファイルを指定エンコーディングで読み込み、UTF-8文字列として返す
 */
function readFileWithEncoding(filePath: string, encoding: string): string {
  const buffer = fs.readFileSync(filePath)
  const enc = encoding.toLowerCase()

  if (enc === 'utf-8' || enc === 'utf8') {
    let text = buffer.toString('utf-8')
    // BOM除去
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1)
    }
    return text
  }

  return iconv.decode(buffer, encoding)
}

/**
 * 列指定から値を取得する
 */
function getColumnValue(row: string[], spec: ColumnSpec): string {
  if ('join' in spec) {
    // 複数列を結合
    return spec.index.map(i => (row[i] || '').trim()).join(spec.join)
  }
  return (row[spec.index] || '').trim()
}

/**
 * 金額文字列を数値に変換する（カンマ、円記号、空白を除去）
 */
function parseAmount(text: string): number {
  if (!text) return 0
  const cleaned = text.replace(/[,¥￥\s円]/g, '').trim()
  if (!cleaned) return 0
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.abs(num)
}

/**
 * 日付文字列をDateオブジェクトに変換する（複数のフォーマットに対応）
 * ExcelへのUTC書き込み時にタイムゾーンで1日ずれないよう、全てUTC基準で生成する
 */
function parseDate(text: string): Date {
  if (!text) return new Date()
  const cleaned = text.trim()

  // YYYYMMDD（8桁数字）
  if (/^\d{8}$/.test(cleaned)) {
    const y = parseInt(cleaned.slice(0, 4), 10)
    const m = parseInt(cleaned.slice(4, 6), 10) - 1
    const d = parseInt(cleaned.slice(6, 8), 10)
    return new Date(Date.UTC(y, m, d))
  }

  // YYMMDD（6桁数字、イオンカード用）
  if (/^\d{6}$/.test(cleaned)) {
    const y = 2000 + parseInt(cleaned.slice(0, 2), 10)
    const m = parseInt(cleaned.slice(2, 4), 10) - 1
    const d = parseInt(cleaned.slice(4, 6), 10)
    return new Date(Date.UTC(y, m, d))
  }

  // YYYY/MM/DD or YYYY-MM-DD
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(cleaned)) {
    const parts = cleaned.split(/[/-]/)
    return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])))
  }

  // YYYY年MM月DD日
  const jpMatch = cleaned.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/)
  if (jpMatch) {
    return new Date(Date.UTC(parseInt(jpMatch[1]), parseInt(jpMatch[2]) - 1, parseInt(jpMatch[3])))
  }

  // 英語月名: Oct 7, 2024（Aliexpress用）
  const enMatch = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (enMatch) {
    const tempDate = new Date(`${enMatch[1]} ${enMatch[2]}, ${enMatch[3]}`)
    return new Date(Date.UTC(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate()))
  }

  // その他: Date コンストラクタで解析後、UTC日付に変換
  const d = new Date(cleaned)
  if (isNaN(d.getTime())) return new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

// =============================================
// CSVパーサー
// =============================================
function parseCsv(config: PluginConfig, filePath: string): ImportedTransaction[] {
  const content = readFileWithEncoding(filePath, config.encoding)
  const lines = content.split(/\r?\n/)

  // ※かつてはここにpaymentDateMetaの処理がありましたが、支払日の概念を廃止したため削除しました。

  // スキップ行を除去
  const skipRows = config.skipRows || 0
  const dataLines = lines.slice(skipRows)

  // csv-parseでパース
  const records: string[][] = csvParse(dataLines.join('\n'), {
    delimiter: config.delimiter || ',',
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  })

  if (!config.columns) return []

  // ヘッダ行がある場合はスキップ
  const startIdx = config.hasHeader ? 1 : 0
  const transactions: ImportedTransaction[] = []

  for (let i = startIdx; i < records.length; i++) {
    const row = records[i]
    if (!row || row.length === 0) continue

    // 日付を取得
    const dateStr = getColumnValue(row, config.columns.date)
    if (!dateStr || dateStr.replace(/\//g, '').trim() === '') continue
    const date = parseDate(dateStr)

    // 残高が必須の場合、残高列が空欄の行はスキップ
    if (config.requireBalance && config.columns.balance) {
      const balStr = getColumnValue(row, config.columns.balance).trim()
      if (!balStr) continue
    }

    // 摘要を取得
    const description = getColumnValue(row, config.columns.description)

    // 金額を取得
    let amount = 0
    let isIncome = false

    if (config.columns.income && config.columns.expense) {
      // 入金・出金が別列の場合
      const incomeVal = parseAmount(getColumnValue(row, config.columns.income))
      const expenseVal = parseAmount(getColumnValue(row, config.columns.expense))
      if (incomeVal > 0) {
        amount = incomeVal
        isIncome = true
      } else if (expenseVal > 0) {
        amount = expenseVal
        isIncome = false
      } else {
        continue // 金額なし
      }
    } else if (config.columns.amount) {
      // 金額が1列の場合
      amount = parseAmount(getColumnValue(row, config.columns.amount))
      if (amount === 0) continue
    } else {
      continue
    }

    // rawDataを構築
    const rawData: Record<string, string> = {}
    row.forEach((val, idx) => { rawData[`col${idx}`] = val })

    // 残高を取得（設定にbalance列がある場合）
    let balance: number | undefined = undefined
    if (config.columns.balance) {
      const balStr = getColumnValue(row, config.columns.balance)
      const bal = parseAmount(balStr)
      if (bal > 0 || balStr.trim() === '0') balance = bal
    }

    // 支払日を取得（CSV列 → メタ行の順で優先）
    // ※かつてのpaymentDate処理は廃止されました

    transactions.push({
      date,
      description,
      amount,
      category: isIncome ? '入金' : '出金',
      paymentMethod: config.name,
      balance,
      rawData,
    })
  }

  // 年度フィルター（filterYear設定がある場合）
  if (config.filterYear) {
    const year = config.filterYear
    const filtered = transactions.filter(tx => tx.date.getUTCFullYear() === year)
    console.log(`年度フィルター: ${year}年のデータ ${filtered.length}件（全${transactions.length}件中）`)
    return filtered
  }

  return transactions
}

// =============================================
// HTMLパーサー
// =============================================
function parseHtmlWithSelectors(config: PluginConfig, filePath: string, selectors: HtmlSelectorsConfig): ImportedTransaction[] {
  const content = readFileWithEncoding(filePath, config.encoding)
  const $ = cheerio.load(content)

  if (!selectors) return []

  const transactions: ImportedTransaction[] = []
  const dateRegex = config.datePattern ? new RegExp(config.datePattern) : null
  const amountRegex = config.amountPattern ? new RegExp(config.amountPattern) : null

  $(selectors.row).each((_, el) => {
    const $el = $(el)

    // 摘要を取得
    const description = $el.find(selectors.description).first().text().trim()
    if (!description) return

    // 日付を取得
    let dateStr = ''
    if (selectors.dateText) {
      const dateTextEl = $el.find(selectors.dateText).first().text().trim()
      if (dateRegex) {
        const match = dateTextEl.match(dateRegex)
        if (match && match[1]) {
          dateStr = match[1]
        }
      } else {
        dateStr = dateTextEl
      }
    }
    // 日付が確認できない場合はスキップ
    if (!dateStr) return
    const date = parseDate(dateStr)
    // 無効な日付（Invalid Date）の場合もスキップ
    if (isNaN(date.getTime())) return

    // 金額を取得
    let amountText = $el.find(selectors.amount).first().text().trim()
    if (amountRegex) {
      const match = amountText.match(amountRegex)
      if (match) amountText = match[0]
    }
    const amount = parseAmount(amountText)

    // 注文番号を取得
    let orderId = ''
    if (selectors.orderId) {
      orderId = $el.find(selectors.orderId).first().text().trim()
    }

    transactions.push({
      date,
      description,
      amount,
      category: undefined,
      paymentMethod: config.name,
      rawData: { description, amount: amountText, date: dateStr, orderId },
    })
  })

  return transactions
}

// =============================================
// テキストパーサー（プレーンテキスト用）
// =============================================
function parseText(config: PluginConfig, filePath: string): ImportedTransaction[] {
  let content = readFileWithEncoding(filePath, config.encoding)

  // 対象ファイルがHTMLの場合、AI用プロンプト生成時と同じようにプレーンテキストに変換する
  const lowerPath = filePath.toLowerCase()
  if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
    content = convert(content, {
      wordwrap: false, // 勝手な改行を防ぐ
      selectors: [
        { selector: 'a', options: { ignoreHref: true } }, // URLを抽出しない
        { selector: 'img', format: 'skip' }, // 画像をスキップ
        { selector: 'nav', format: 'skip' }, // ナビゲーションをスキップ
        { selector: 'footer', format: 'skip' }
      ]
    })
  }

  if (!config.textPatterns) return []
  const { blockSeparator, date: datePat, description: descPat, amount: amountPat, orderId: orderIdPat } = config.textPatterns

  // レコード区切り正規表現（セパレータの直前で分割しつつ、セパレータを残す）
  const separatorRegex = new RegExp(`(?=${blockSeparator})`, 'g')
  const blocks = content.split(separatorRegex).map(b => b.trim()).filter(b => b.length > 0)

  const dateRegex = new RegExp(datePat)
  const descRegex = new RegExp(descPat)
  const amountRegex = new RegExp(amountPat)
  const orderIdRegex = orderIdPat ? new RegExp(orderIdPat) : null

  const transactions: ImportedTransaction[] = []

  for (const block of blocks) {
    // 日付の抽出
    const dateMatch = block.match(dateRegex)
    if (!dateMatch) continue
    const dateStr = dateMatch[1]
    const date = parseDate(dateStr)

    // 金額の抽出（ORパターンのキャプチャグループから最初に見つかった非空の値を採用）
    const amountMatch = block.match(amountRegex)
    if (!amountMatch) continue
    const amountVal = amountMatch.slice(1).find(v => v !== undefined)
    if (!amountVal) continue
    const amount = parseAmount(amountVal)

    // 摘要の抽出
    const descMatch = block.match(descRegex)
    if (!descMatch) continue
    const description = descMatch[1].trim()

    // 注文番号の抽出（任意）
    let orderId = ''
    if (orderIdRegex) {
      const orderIdMatch = block.match(orderIdRegex)
      if (orderIdMatch) {
        orderId = orderIdMatch[1].trim()
      }
    }

    transactions.push({
      date,
      description,
      amount,
      category: undefined,
      paymentMethod: config.name,
      rawData: { description, amount: String(amount), date: dateStr, orderId },
    })
  }

  return transactions
}


// =============================================
// 日付年月日のみ比較用ヘルパー
// =============================================
function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// =============================================
// 残高チェーンに基づく並び替え
// 同日内の取引を「前行残高 + 入金 - 支払 = 当行残高」の
// 関係が成り立つ順序に並べ替える
// =============================================
function sortWithBalanceChain(transactions: ImportedTransaction[]): ImportedTransaction[] {
  if (transactions.length <= 1) return transactions

  // 日付ごとにグループ化
  const byDate = new Map<string, ImportedTransaction[]>()
  for (const tx of transactions) {
    const key = dateToYmd(tx.date)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(tx)
  }

  // 日付キーを昇順ソート
  const dateKeys = Array.from(byDate.keys()).sort()

  const result: ImportedTransaction[] = []
  let lastBalance: number | null = null

  for (const dateKey of dateKeys) {
    const group = byDate.get(dateKey)!

    if (group.length === 1) {
      // 1件のみ: そのまま追加
      result.push(group[0])
      if (group[0].balance !== undefined) lastBalance = group[0].balance
      continue
    }

    // 残高情報がない場合はそのまま追加
    if (!group.some(tx => tx.balance !== undefined)) {
      result.push(...group)
      continue
    }

    // 同日複数件: 残高チェーンで正しい順序を再構築
    const remaining = [...group]
    let chainBuilt = false

    // lastBalanceが分かっている場合、チェーンを辿る
    if (lastBalance !== null) {
      let currentBalance = lastBalance
      const ordered: ImportedTransaction[] = []

      while (remaining.length > 0) {
        let found = false
        for (let i = 0; i < remaining.length; i++) {
          const tx = remaining[i]
          if (tx.balance === undefined) continue

          // この取引の「前残高」を逆算: 前残高 = 残高 - 入金 + 支払
          const income = tx.category === '入金' ? tx.amount : 0
          const expense = tx.category === '出金' ? tx.amount : 0
          const prevBalance = tx.balance - income + expense

          if (Math.abs(prevBalance - currentBalance) < 0.01) {
            ordered.push(tx)
            currentBalance = tx.balance
            remaining.splice(i, 1)
            found = true
            break
          }
        }

        if (!found) {
          // チェーンが途切れた場合、残りをそのまま追加
          ordered.push(...remaining)
          remaining.length = 0
        }
      }

      result.push(...ordered)
      const lastTx = ordered[ordered.length - 1]
      if (lastTx.balance !== undefined) lastBalance = lastTx.balance
      chainBuilt = true
    }

    if (!chainBuilt) {
      // lastBalanceが不明な場合: 残高の大小関係から順序を推定
      // 残高が大きい→小さい順は出金が先、小さい→大きい順は入金が先
      // 残高チェーンを逆算で構築する
      const withBalance = remaining.filter(tx => tx.balance !== undefined)

      if (withBalance.length >= 2) {
        // 各取引の「前残高」を計算し、チェーンを構築
        type ChainNode = { tx: ImportedTransaction, prevBalance: number }
        const nodes: ChainNode[] = withBalance.map(tx => {
          const income = tx.category === '入金' ? tx.amount : 0
          const expense = tx.category === '出金' ? tx.amount : 0
          return { tx, prevBalance: tx.balance! - income + expense }
        })

        // 他のどのノードの残高にもならない前残高を持つノードが先頭
        const ordered: ImportedTransaction[] = []
        const usedIndices = new Set<number>()

        // 先頭候補: 自分のprevBalanceが他のどのノードのbalanceとも一致しないノード
        let startIdx = -1
        for (let i = 0; i < nodes.length; i++) {
          const prevBal = nodes[i].prevBalance
          const isLinkedFrom = nodes.some((n, j) => j !== i && n.tx.balance !== undefined && Math.abs(n.tx.balance - prevBal) < 0.01)
          if (!isLinkedFrom) {
            startIdx = i
            break
          }
        }
        if (startIdx === -1) startIdx = 0

        // チェーンを辿る
        let currentBal = nodes[startIdx].prevBalance
        while (ordered.length < nodes.length) {
          let found = false
          for (let i = 0; i < nodes.length; i++) {
            if (usedIndices.has(i)) continue
            if (Math.abs(nodes[i].prevBalance - currentBal) < 0.01) {
              ordered.push(nodes[i].tx)
              currentBal = nodes[i].tx.balance!
              usedIndices.add(i)
              found = true
              break
            }
          }
          if (!found) {
            // 未使用のものをそのまま追加
            for (let i = 0; i < nodes.length; i++) {
              if (!usedIndices.has(i)) {
                ordered.push(nodes[i].tx)
                usedIndices.add(i)
              }
            }
            break
          }
        }

        // 残高なしの取引も追加
        const withoutBalance = remaining.filter(tx => tx.balance === undefined)
        result.push(...ordered, ...withoutBalance)
        const lastTx = ordered[ordered.length - 1]
        if (lastTx.balance !== undefined) lastBalance = lastTx.balance
      } else {
        result.push(...remaining)
        const lastTx = remaining[remaining.length - 1]
        if (lastTx.balance !== undefined) lastBalance = lastTx.balance
      }
    }
  }

  return result
}

// =============================================
// 複数ファイルパース（multiFile対応）
// =============================================
export async function parseFiles(config: PluginConfig, filePaths: string[]): Promise<ImportedTransaction[]> {
  const allTransactions: ImportedTransaction[] = []

  let htmlListTxs: ImportedTransaction[] = []
  let htmlDetailTxs: ImportedTransaction[] = []

  for (const fp of filePaths) {
    let transactions: ImportedTransaction[] = []

    if (config.format === 'html') {
      if (config.htmlMerge && config.selectors) {
        // マージモード: 一覧と詳細を判定
        const tList = parseHtmlWithSelectors(config, fp, config.selectors)
        const tDetail = parseHtmlWithSelectors(config, fp, config.htmlMerge.detailSelectors)
        if (tList.length > 0 && tDetail.length === 0) {
          htmlListTxs.push(...tList)
        } else if (tDetail.length > 0 && tList.length === 0) {
          htmlDetailTxs.push(...tDetail)
        } else if (tList.length > 0 && tDetail.length > 0) {
          if (tDetail.length >= tList.length) {
            htmlDetailTxs.push(...tDetail)
          } else {
            htmlListTxs.push(...tList)
          }
        }
        continue // マージモードの場合は後でまとめて処理するのでスキップ
      } else {
        transactions = parseHtmlWithSelectors(config, fp, config.selectors!)
      }
    } else if (config.format === 'text') {
      transactions = parseText(config, fp)
    } else {
      transactions = parseCsv(config, fp)
    }

    allTransactions.push(...transactions)
  }

  // HTMLマージモードの後処理
  if (config.format === 'html' && config.htmlMerge) {
    const listMap = new Map<string, ImportedTransaction>()
    for (const tx of htmlListTxs) {
      const key = config.htmlMerge.matchKey === 'orderId' ? tx.rawData.orderId : tx.rawData.date
      if (key) listMap.set(key, tx)
    }

    for (const tx of htmlDetailTxs) {
      // 詳細行を抽出してallTransactionsに追加するだけ。親の支払いID付与は行わない。
      allTransactions.push(tx)
    }

    // もし詳細がない一覧要素（単体商品など）があればそれも追加する
    for (const tx of htmlListTxs) {
      const key = config.htmlMerge.matchKey === 'orderId' ? tx.rawData.orderId : tx.rawData.date
      const hasDetail = htmlDetailTxs.some(d => (config.htmlMerge!.matchKey === 'orderId' ? d.rawData.orderId : d.rawData.date) === key)
      if (!hasDetail) {
        allTransactions.push(tx)
      }
    }
  }

  // 残高チェーンに基づく並び替え（日付昇順＋同日内は残高整合順）
  const sorted = sortWithBalanceChain(allTransactions)

  return sorted
}

// =============================================
// JSON設定からImportPluginオブジェクトを生成
// =============================================
export function createPluginFromConfig(config: PluginConfig): ImportPlugin {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    supportedExtensions: config.supportedExtensions,
    targetSheet: config.targetSheet,
    defaultDebitAccount: config.defaultDebitAccount,
    defaultCreditAccount: config.defaultCreditAccount,
    defaultCreditSubAccount: config.defaultCreditSubAccount,

    async parse(filePath: string): Promise<ImportedTransaction[]> {
      return parseFiles(config, [filePath])
    },

    toJournalEntries(transactions: ImportedTransaction[], mappingRules?: MappingRule[]): JournalEntry[] {
      const rules = mappingRules || (config.mappingRules || []).map(r => ({
        keyword: r.keyword,
        debitAccount: r.debitAccount,
        debitSubAccount: r.debitSubAccount,
        creditAccount: r.creditAccount,
        creditSubAccount: r.creditSubAccount,
      }))

      return transactions.map(tx => {
        // マッピングルールでマッチするか確認
        let debitAcc = config.defaultDebitAccount
        let debitSub = config.defaultDebitSubAccount
        let creditAcc = config.defaultCreditAccount
        let creditSub = config.defaultCreditSubAccount

        // 入金/出金で科目を切り替え
        if (tx.category === '入金') {
          // 入金: 借方がこの口座、貸方が相手
          debitAcc = config.defaultDebitAccount
          debitSub = config.defaultDebitSubAccount
          creditAcc = config.defaultCreditAccount
          creditSub = config.defaultCreditSubAccount
        } else {
          // 出金: 借方が相手科目、貸方がこの口座
          debitAcc = config.defaultCreditAccount
          debitSub = config.defaultCreditSubAccount
          creditAcc = config.defaultDebitAccount
          creditSub = config.defaultDebitSubAccount
        }

        // キーワードマッピングを適用
        for (const rule of rules) {
          if (tx.description.includes(rule.keyword)) {
            if (tx.category === '入金') {
              creditAcc = rule.debitAccount
              creditSub = rule.debitSubAccount
            } else {
              debitAcc = rule.debitAccount
              debitSub = rule.debitSubAccount
            }
            if (rule.creditAccount) {
              if (tx.category === '入金') {
                debitAcc = rule.creditAccount
                debitSub = rule.creditSubAccount
              } else {
                creditAcc = rule.creditAccount
                creditSub = rule.creditSubAccount
              }
            }
            break
          }
        }

        return {
          id: uuidv4(),
          date: tx.date,
          debitAccount: debitAcc,
          debitSubAccount: debitSub,
          creditAccount: creditAcc,
          creditSubAccount: creditSub,
          amount: tx.amount,
          description: tx.description,
          note: '',
          sourceSheet: config.name,
        }
      })
    }
  }
}

// =============================================
// フォルダからJSON設定ファイルを一括読み込み
// =============================================
export function loadPluginConfigs(configDir: string): PluginConfig[] {
  if (!fs.existsSync(configDir)) return []

  const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json'))
  const configs: PluginConfig[] = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(configDir, file), 'utf-8')
      const config = JSON.parse(content) as PluginConfig
      configs.push(config)
    } catch (err) {
      console.error(`プラグイン設定ファイルの読み込みエラー: ${file}`, err)
    }
  }

  return configs
}

// =============================================
// クレジットカード明細とショッピング注文履歴の突合マッチング
// =============================================
export function matchCardAndShopping(
  cardTransactions: ImportedTransaction[],
  shoppingTransactions: ImportedTransaction[],
  keywords: string[]
): ImportedTransaction[] {
  const result: ImportedTransaction[] = []
  const targetCardTxs: ImportedTransaction[] = []

  // パス1: 対象外（ショッピング以外）と対象を分離
  for (const cardTx of cardTransactions) {
    const isTarget = keywords.some(kw => cardTx.description.toUpperCase().includes(kw.toUpperCase()))
    if (isTarget) {
      targetCardTxs.push(cardTx)
    } else {
      result.push(cardTx)
    }
  }

  const availableOrders = [...shoppingTransactions]
  const matchedOrderIndices = new Set<number>()

  // 注文を Order ID ごとにグループ化
  const getOrderId = (tx: ImportedTransaction): string => {
    return tx.rawData.col9 || tx.rawData.orderId || '';
  }

  const ordersByOrderId = new Map<string, { txs: ImportedTransaction[], indices: number[] }>()
  availableOrders.forEach((tx, idx) => {
    const orderId = getOrderId(tx)
    if (!orderId) return
    if (!ordersByOrderId.has(orderId)) {
      ordersByOrderId.set(orderId, { txs: [], indices: [] })
    }
    ordersByOrderId.get(orderId)!.txs.push(tx)
    ordersByOrderId.get(orderId)!.indices.push(idx)
  })

  // マッチしなかったカード明細を保持するリスト
  const unmatchedCardTxs: ImportedTransaction[] = []

  // パス2-1: 1対1マッチ（最も単純なケース）
  for (const cardTx of targetCardTxs) {
    let bestMatchIdx = -1
    let minDateDiff = Infinity

    for (let i = 0; i < availableOrders.length; i++) {
      if (matchedOrderIndices.has(i)) continue
      const orderTx = availableOrders[i]

      if (Math.abs(cardTx.amount - orderTx.amount) < 0.01) {
        const diffDays = Math.abs(cardTx.date.getTime() - orderTx.date.getTime()) / (1000 * 60 * 60 * 24)
        if (diffDays <= 7) {
          if (diffDays < minDateDiff) {
            minDateDiff = diffDays
            bestMatchIdx = i
          }
        }
      }
    }

    if (bestMatchIdx !== -1) {
      matchedOrderIndices.add(bestMatchIdx)
      const orderTx = availableOrders[bestMatchIdx]
      result.push({
        ...cardTx,
        description: orderTx.description, // 商品名に差し替え
      })
    } else {
      unmatchedCardTxs.push(cardTx)
    }
  }

  // パス2-2: 複数対1マッチ（1つのカード請求が、同一 Order ID の複数商品の合計と一致する）
  const finalUnmatchedCardTxs: ImportedTransaction[] = []

  for (const cardTx of unmatchedCardTxs) {
    let bestOrderId = ''
    let minDateDiff = Infinity

    for (const [orderId, group] of ordersByOrderId.entries()) {
      if (group.indices.some(idx => matchedOrderIndices.has(idx))) continue

      // グループの合計金額を算出
      const groupTotal = group.txs.reduce((sum, tx) => sum + tx.amount, 0)

      if (Math.abs(cardTx.amount - groupTotal) < 0.01) {
        const orderDate = group.txs[0].date
        const diffDays = Math.abs(cardTx.date.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)

        if (diffDays <= 7) {
          if (diffDays < minDateDiff) {
            minDateDiff = diffDays
            bestOrderId = orderId
          }
        }
      }
    }

    if (bestOrderId) {
      const group = ordersByOrderId.get(bestOrderId)!
      group.indices.forEach(idx => matchedOrderIndices.add(idx))

      // カード明細の1行を、注文履歴の商品ごとの複数行に分割・展開
      group.txs.forEach(orderTx => {
        result.push({
          ...cardTx,
          description: orderTx.description, // 商品名
          amount: orderTx.amount,           // その商品の個別金額
        })
      })
    } else {
      finalUnmatchedCardTxs.push(cardTx)
    }
  }

  // パス2-3: それでもマッチしなかったカード請求はそのまま元の内容で追加
  for (const cardTx of finalUnmatchedCardTxs) {
    result.push(cardTx)
  }

  // 日付で昇順ソートして返す
  return result.sort((a, b) => a.date.getTime() - b.date.getTime())
}

