/**
 * Excel転記サービス
 * パースした取引データをExcelワークシートに書き込む
 * 重複チェックによる増分インポート対応
 * 銀行・クレジットカード両方のシートレイアウトに対応
 */
import * as ExcelJS from 'exceljs'
import { ImportedTransaction } from '../../src/types/import-plugin'

// シートレイアウト種別
export type SheetLayout = 'bank' | 'credit-card'

/**
 * 日付を年月日のみで比較するためのヘルパー（時刻を無視）
 */
function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Excelの日付値をYMD文字列に変換する
 */
function excelDateToYmd(val: any): string {
  if (!val) return ''
  if (val instanceof Date) return dateToYmd(val)
  if (typeof val === 'string') {
    const d = new Date(val)
    if (!isNaN(d.getTime())) return dateToYmd(d)
  }
  return ''
}

/**
 * 日付の近接性と金額から、カード明細とショッピング注文が一致するか判定する
 */
export function isDateAmountMatch(dateA: Date, amountA: number, dateB: Date, amountB: number): boolean {
  if (Math.abs(amountA - amountB) > 0.01) return false
  const diffDays = Math.abs(dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays <= 7
}

export interface PaymentSyncConfig {
  sheetName: string;      // 対象シート名（例: 'Amazon'）
  account: string;        // 勘定科目 (例: '消耗品費')
  subAccount: string;     // 補助科目 (例: 'Amazon')
  settleAcc: string;      // 決済先科目 (例: '未払金')
  settleSub: string;      // 決済先補助 (例: '三井住友カード')
  keyword: string;        // 検索キーワード (例: 'AMAZON')
}

export interface SheetColumns {
  dateCol: number;      // '日付'
  accountCol?: number;  // '勘定科目'
  subAccountCol?: number;// '補助科目'
  descCol: number;      // '摘要' または '項目名'
  amountCol: number;    // '金額' (クレジットカード等)
  incomeCol?: number;   // '入金' / '入金額' / 'お預り金額' / '収入'
  expenseCol?: number;  // '支払' / '出金額' / '出金' / '支出'
  balanceCol?: number;  // '残高'
  memoCol?: number;     // '備考'
}

// 設定シートから決済同期に関連する情報をパースする
export function loadSyncConfigs(workbook: ExcelJS.Workbook): PaymentSyncConfig[] {
  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) return []

  const configs: PaymentSyncConfig[] = []
  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return // ヘッダーをスキップ
    const sheetName = row.getCell(1).text.trim()
    const account = row.getCell(2).text.trim()
    const subAccount = row.getCell(3).text.trim()
    const settleAcc = row.getCell(4).text.trim()
    const settleSub = row.getCell(5).text.trim()
    const keyword = row.getCell(6).text.trim()

    if (account) {
      configs.push({
        sheetName,
        account,
        subAccount,
        settleAcc,
        settleSub,
        keyword
      })
    }
  })
  return configs
}

// ヘッダー行をスキャンして列インデックスを検出する
export function detectSheetColumns(sheet: ExcelJS.Worksheet): SheetColumns {
  const cols: SheetColumns = { dateCol: 1, descCol: 3, amountCol: 4 }
  
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    if (text === '日付') cols.dateCol = colNum
    if (text === '勘定科目') cols.accountCol = colNum
    if (text === '補助科目') cols.subAccountCol = colNum
    if (text === '摘要' || text === '項目名') cols.descCol = colNum
    
    // クレジットカード用
    if (text === '金額' || text === 'お支払金額' || text === '支払金額') cols.amountCol = colNum
    
    // 銀行用
    if (text === '入金' || text === '入金額' || text === 'お預り金額' || text === '収入') cols.incomeCol = colNum
    if (text === '支払' || text === '出金額' || text === '出金' || text === '支出' || text === '払出金額') cols.expenseCol = colNum
    if (text === '残高') cols.balanceCol = colNum
    if (text === '備考') cols.memoCol = colNum
  })
  
  if (!cols.accountCol) cols.accountCol = 2 // デフォルトの勘定科目列
  return cols
}

/**
 * ワークシートから既存データ行を全件読み取る
 * レイアウトに応じて金額の読み取り列を変更
 */
interface ExistingRow {
  ymd: string         // 日付 (YYYY-MM-DD)
  description: string // 摘要
  income: number      // 入金 or 金額（credit-card）
  expense: number     // 支払（bankのみ、credit-cardでは0）
}

function getExistingRows(sheet: ExcelJS.Worksheet, layout: SheetLayout, dataStartRow: number = 3, cols?: SheetColumns): { rows: ExistingRow[], lastDataRow: number } {
  const rows: ExistingRow[] = []
  let lastDataRow = dataStartRow - 1 // ヘッダ行（と前期繰越行）

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < dataStartRow) return // ヘッダ行・前期繰越行はスキップ

    const dateVal = row.getCell(1).value
    if (!dateVal) return

    lastDataRow = rowNumber

    const ymd = excelDateToYmd(dateVal)
    const description = String(row.getCell(cols?.descCol || 3).value || '').trim()

    let income = 0
    let expense = 0

    if (layout === 'credit-card') {
      // クレジットカード
      const amountVal = row.getCell(cols?.amountCol || 4).value
      income = typeof amountVal === 'number' ? amountVal : 0
    } else {
      // 銀行
      const incomeVal = row.getCell(cols?.incomeCol || 4).value
      const expenseVal = row.getCell(cols?.expenseCol || 5).value
      income = typeof incomeVal === 'number' ? incomeVal : 0
      expense = typeof expenseVal === 'number' ? expenseVal : 0
    }

    rows.push({ ymd, description, income, expense })
  })

  return { rows, lastDataRow }
}

/**
 * 重複チェックによる増分インポート
 *
 * ロジック:
 * CSVの各行について、ワークシートに「同じ日付・同じ摘要・同じ金額」の行が
 * 既に存在するかをチェックし、存在しない行のみを新規データとして返す。
 * 同じ取引が同日に複数回ある場合（例: 同額の振替）も正しくカウントする。
 */
function filterNewTransactions(
  transactions: ImportedTransaction[],
  existing: ExistingRow[],
  layout: SheetLayout
): ImportedTransaction[] {
  // 既存行をカウントマップに変換（同一キーが複数ある場合に対応）
  const existingCounts = new Map<string, number>()
  for (const row of existing) {
    const key = `${row.ymd}|${row.description}|${row.income}|${row.expense}`
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1)
  }

  // 使用済みカウントを追跡
  const usedCounts = new Map<string, number>()
  const newTransactions: ImportedTransaction[] = []

  for (const tx of transactions) {
    const ymd = dateToYmd(tx.date)

    let key: string
    if (layout === 'credit-card') {
      // クレジットカード: 金額1列
      key = `${ymd}|${tx.description}|${tx.amount}|0`
    } else {
      // 銀行: 入金/支払で分離
      const income = tx.category === '入金' ? tx.amount : 0
      const expense = tx.category === '出金' ? tx.amount : 0
      key = `${ymd}|${tx.description}|${income}|${expense}`
    }

    const existCount = existingCounts.get(key) || 0
    const usedCount = usedCounts.get(key) || 0

    if (usedCount < existCount) {
      // この取引は既にワークシートに存在する → スキップ
      usedCounts.set(key, usedCount + 1)
    } else {
      // 新規取引 → 追加対象
      newTransactions.push(tx)
    }
  }

  return newTransactions
}

/**
 * 取引データをExcelワークシートに転記する
 * - 重複チェック対応: 既存データと照合して新規分のみ追記
 * - 銀行/クレジットカード両方のシートレイアウトに対応
 *
 * @param excelPath Excelファイルのパス
 * @param sheetName 書き込み先ワークシート名
 * @param transactions 転記する取引データ
 * @param layout シートレイアウト種別（デフォルト: 'bank'）
 * @param hasOpeningBalance 前期繰越行の有無（デフォルト: bankはtrue、credit-cardはfalse）
 * @returns 書き込んだ件数
 */
export async function writeTransactionsToSheet(
  excelPath: string,
  sheetName: string,
  transactions: ImportedTransaction[],
  layoutParam?: SheetLayout,
  hasOpeningBalance?: boolean
): Promise<number> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)

  // ワークシートを取得、なければ新規作成
  let sheet = workbook.getWorksheet(sheetName)
  let startRow: number

  // ヘッダー行が存在する（行数が1以上）場合、列位置を自動検出
  let colsA: SheetColumns = { dateCol: 1, descCol: 3, amountCol: 4 }
  if (sheet && sheet.rowCount > 0) {
    colsA = detectSheetColumns(sheet)
  }

  // レイアウトの判定 (明示指定がない場合はシートのヘッダーから自動判定)
  let layout: SheetLayout = layoutParam || 'bank'
  if (!layoutParam && sheet && sheet.rowCount > 0) {
    if (colsA.incomeCol !== undefined && colsA.expenseCol !== undefined) {
      layout = 'bank'
    } else {
      layout = 'credit-card'
    }
  }

  // 既存シートの2行目に「前期繰越」があるかを動的に検出
  let hasOpeningRow = false
  if (sheet && sheet.rowCount >= 2) {
    const secondRowVal = String(sheet.getRow(2).getCell(3).value || '').trim()
    if (secondRowVal === '前期繰越') {
      hasOpeningRow = true
    }
  }

  // 前期繰越行の有無を決定（明示指定がなければシートの状態またはレイアウトから推定）
  const useOpeningBalance = hasOpeningBalance !== undefined
    ? hasOpeningBalance
    : (sheet ? hasOpeningRow : (layout === 'bank'))

  // ヘッダ後のデータ開始行（前期繰越行がある場合は3行目、ない場合は2行目）
  const dataStartRow = useOpeningBalance ? 3 : 2

  // 日付で昇順ソート
  const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime())

  let toWrite: ImportedTransaction[]

  // レイアウトに応じたヘッダ
  const headers = layout === 'credit-card'
    ? ['日付', '勘定科目', '摘要', '金額', '備考']
    : ['日付', '勘定科目', '摘要', '入金', '支払', '残高', '備考']

  if (!sheet) {
    // 新規ワークシート作成（ヘッダ付き）
    sheet = workbook.addWorksheet(sheetName)
    sheet.getRow(1).values = headers
    // ヘッダ行のスタイル設定
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center' }
    })
    if (useOpeningBalance) {
      // 前期繰越行を作成
      sheet.getRow(2).getCell(3).value = '前期繰越'
    }
    startRow = dataStartRow
    toWrite = sorted
  } else {
    // 既存シート: 重複チェックで新規分のみ抽出
    const { rows: existingRows, lastDataRow } = getExistingRows(sheet, layout, dataStartRow, colsA)

    if (existingRows.length > 0) {
      toWrite = filterNewTransactions(sorted, existingRows, layout)
      console.log(`増分インポート: 既存${existingRows.length}件, 新規${toWrite.length}件（全${sorted.length}件中）`)
    } else {
      // 既存データなし: 全件書き込み
      toWrite = sorted
    }

    startRow = Math.max(dataStartRow, lastDataRow + 1)
  }

  if (toWrite.length === 0) {
    return 0
  }

  // データ書き込み
  let insertedCount = 0
  for (let i = 0; i < toWrite.length; i++) {
    const tx = toWrite[i]
    const row = sheet.getRow(startRow + i)

    // タイムゾーンによる時差のずれ（前日の日付になってしまう現象）を防ぐため、
    // 時刻を安全な「昼の12時（12:00:00）」に設定した日付オブジェクトを代入します
    const safeDate = new Date(tx.date)
    safeDate.setHours(12, 0, 0, 0)
    row.getCell(colsA.dateCol).value = safeDate                     // 日付
    
    // 勘定科目・補助科目（TSV直接生成などのJournalEntry形式に対応）
    const txAny = tx as any
    const account = txAny.creditAccount || txAny.debitAccount || ''
    const subAccount = txAny.creditSubAccount || txAny.debitSubAccount || ''
    
    if (colsA.accountCol) row.getCell(colsA.accountCol).value = account
    if (colsA.subAccountCol) row.getCell(colsA.subAccountCol).value = subAccount
    
    row.getCell(colsA.descCol).value = tx.description || ''        // 摘要
    
    if (colsA.memoCol && txAny.memo) {
      row.getCell(colsA.memoCol).value = txAny.memo                // 備考
    }

    if (layout === 'credit-card') {
      row.getCell(colsA.amountCol || 4).value = tx.amount               // 金額
      row.getCell(colsA.amountCol || 4).numFmt = '#,##0'
      row.commit()
      insertedCount++
    } else {
      // 銀行
      const inCol = colsA.incomeCol || 4
      const exCol = colsA.expenseCol || 5
      const balCol = colsA.balanceCol || 6

      if (tx.category === '入金') {
        row.getCell(inCol).value = tx.amount                // 入金
        row.getCell(exCol).value = null                     // 支払
      } else {
        row.getCell(inCol).value = null                     // 入金
        row.getCell(exCol).value = tx.amount                // 支払
      }

      if (tx.balance !== undefined) {
        row.getCell(balCol).value = tx.balance               // 残高
      }
    }

    row.getCell(colsA.dateCol).numFmt = 'YYYY/MM/DD'
  }

  // =============================================
  // F2セル（前期繰越残高）の自動記入（前期繰越行がある場合のみ）
  // =============================================
  if (useOpeningBalance) {
    const balCol = colsA.balanceCol || 6
    const f2Value = sheet.getRow(2).getCell(balCol).value
    if (!f2Value && f2Value !== 0) {
      let openingBalance: number | null = null

      // 1. 設定シートから繰越残高を取得
      const settingsSheet = workbook.getWorksheet('設定')
      if (settingsSheet) {
        settingsSheet.eachRow((row) => {
          const cellA = String(row.getCell(1).value || '').trim()
          if (cellA === sheetName) {
            const balVal = row.getCell(7).value // G列: 繰越残高
            if (typeof balVal === 'number') {
              openingBalance = balVal
            }
          }
        })
      }

      // 2. 設定シートにもなければCSV先頭データから逆算
      if (openingBalance === null && sorted.length > 0) {
        const firstTx = sorted[0]
        if (firstTx.balance !== undefined) {
          const income = firstTx.category === '入金' ? firstTx.amount : 0
          const expense = firstTx.category === '出金' ? firstTx.amount : 0
          openingBalance = firstTx.balance - income + expense
          console.log(`前期繰越額をCSV先頭データから逆算: ${openingBalance}`)
        }
      }

      if (openingBalance !== null) {
        sheet.getRow(2).getCell(balCol).value = openingBalance
        sheet.getRow(2).getCell(balCol).numFmt = '#,##0'
        console.log(`前期繰越額を記入: ${sheetName} F2 = ${openingBalance}`)
      }
    }
  }

  // ファイル保存
  await workbook.xlsx.writeFile(excelPath)

  return toWrite.length
}

/**
 * 特定の取引行（日付・摘要・金額が一致する行）の金額および備考を書き換えて上書き保存する
 */
export async function updateRowFields(
  excelPath: string,
  sheetName: string,
  searchTx: { date: Date; description: string; amount: number },
  updateFields: { amount?: number; memo?: string }
): Promise<boolean> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) return false

  const cols = detectSheetColumns(sheet)

  let found = false
  // 比較用に日付を YYYY-MM-DD 文字列にする
  const targetDateObj = new Date(searchTx.date)
  const targetYmd = dateToYmd(targetDateObj)
  const targetDesc = searchTx.description.trim()

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // ヘッダーをスキップ

    const dateVal = row.getCell(cols.dateCol).value
    if (!dateVal) return

    const ymd = excelDateToYmd(dateVal)
    const desc = String(row.getCell(cols.descCol).value || '').trim()
    
    // 金額列のチェック
    let amt = 0
    if (cols.amountCol) {
      amt = Number(row.getCell(cols.amountCol).value) || 0
    } else if (cols.incomeCol && cols.expenseCol) {
      // 銀行などの2列構成
      const inc = Number(row.getCell(cols.incomeCol).value) || 0
      const exp = Number(row.getCell(cols.expenseCol).value) || 0
      amt = inc > 0 ? inc : exp
    }

    if (ymd === targetYmd && desc === targetDesc && amt === searchTx.amount) {
      // 備考の更新
      if (updateFields.memo !== undefined && cols.memoCol) {
        row.getCell(cols.memoCol).value = updateFields.memo
      }
      // 金額の更新
      if (updateFields.amount !== undefined) {
        if (cols.amountCol) {
          row.getCell(cols.amountCol).value = updateFields.amount
        } else if (cols.incomeCol && cols.expenseCol) {
          if (row.getCell(cols.incomeCol).value !== null && Number(row.getCell(cols.incomeCol).value) > 0) {
            row.getCell(cols.incomeCol).value = updateFields.amount
          } else {
            row.getCell(cols.expenseCol).value = updateFields.amount
          }
        }
      }
      found = true
    }
  })

  if (found) {
    await workbook.xlsx.writeFile(excelPath)
    return true
  }
  return false
}

// ===================================================================
// 突合結果をExcelに書き込む
// ===================================================================

/**
 * 突合1件分の情報
 */
export interface ReconciliationItem {
  reconcileNo: string          // 突合No（例: "0000"）
  // 発生側の行特定情報
  sourceSheetName: string      // 発生側シート名（例: "AliExpress"）
  sourceDate: string           // 発生側日付 (ISO文字列)
  sourceAmount: number         // 発生側金額
  sourceDescription: string    // 発生側摘要
  // 決済側の行特定情報
  settleSheetName: string      // 決済側シート名（例: "Amazonカード"）
  settleDate: string           // 決済側日付 (ISO文字列)
  settleAmount: number         // 決済側金額
  settleDescription: string    // 決済側摘要
  // 転記内容
  creditAccount: string        // 決済側に転記する相手科目（例: "未払金"）
  creditSubAccount: string     // 決済側に転記する補助科目（例: "AliExpress"）
  // 変更金額（手動突合時の差額調整用）
  newSourceAmount?: number
  newSettleAmount?: number
}

/**
 * 突合結果をExcelファイルに書き込む
 *
 * 各突合について:
 * 1. 発生側シートの該当行の備考欄に「#NNNN」を追記
 * 2. 決済側シートの該当行の勘定科目に creditAccount、補助科目に creditSubAccount を転記
 * 3. 決済側シートの該当行の備考欄に「#NNNN」を追記
 *
 * @param excelPath Excelファイルのパス
 * @param items 突合結果の配列
 * @returns 処理した突合件数
 */
export async function applyReconciliation(
  excelPath: string,
  items: ReconciliationItem[]
): Promise<number> {
  if (items.length === 0) return 0

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)

  let processedCount = 0

  for (const item of items) {
    const reconcileTag = item.reconcileNo ? `#${item.reconcileNo}` : ''

    // --- 発生側シートの備考欄に突合Noを追記 ---
    const sourceSheet = workbook.getWorksheet(item.sourceSheetName)
    if (sourceSheet) {
      const srcCols = detectSheetColumns(sourceSheet)
      const targetYmd = dateToYmd(new Date(item.sourceDate))
      let matchedSource = false

      sourceSheet.eachRow((row, rowNumber) => {
        if (matchedSource) return // 既に1件書き込んだらスキップ
        if (rowNumber === 1) return // ヘッダーをスキップ
        const dateVal = row.getCell(srcCols.dateCol).value
        if (!dateVal) return

        const ymd = excelDateToYmd(dateVal)
        const desc = String(row.getCell(srcCols.descCol).value || '').trim()
        // 金額の取得（1列/2列構成に対応）
        let amt = 0
        if (srcCols.amountCol && !srcCols.incomeCol) {
          amt = Number(row.getCell(srcCols.amountCol).value) || 0
        } else if (srcCols.incomeCol && srcCols.expenseCol) {
          const inc = Number(row.getCell(srcCols.incomeCol).value) || 0
          const exp = Number(row.getCell(srcCols.expenseCol).value) || 0
          amt = inc > 0 ? inc : exp
        } else {
          amt = Number(row.getCell(srcCols.amountCol).value) || 0
        }

        // 既に突合済みならスキップ
        const existingMemo = String(row.getCell(srcCols.memoCol || 6).value || '')
        if (existingMemo.match(/#\d{4}/)) return

        const normDesc1 = desc.replace(/\s+/g, '')
        const normDesc2 = (item.sourceDescription || '').replace(/\s+/g, '')

        if (ymd === targetYmd && amt === item.sourceAmount && normDesc1 === normDesc2) {
          // 金額の更新（手動突合による差額調整）
          if (item.newSourceAmount !== undefined) {
            if (srcCols.amountCol && !srcCols.incomeCol) {
              row.getCell(srcCols.amountCol).value = item.newSourceAmount
            } else if (srcCols.incomeCol && srcCols.expenseCol) {
              const inc = Number(row.getCell(srcCols.incomeCol).value) || 0
              if (inc > 0) {
                row.getCell(srcCols.incomeCol).value = item.newSourceAmount
              } else {
                row.getCell(srcCols.expenseCol).value = item.newSourceAmount
              }
            } else if (srcCols.amountCol) {
              row.getCell(srcCols.amountCol).value = item.newSourceAmount
            }
          }

          // 備考欄に突合Noを追記（reconcileNoがある場合のみ）
          if (reconcileTag) {
            const memoCol = srcCols.memoCol || 6
            const currentMemo = String(row.getCell(memoCol).value || '').trim()
            if (!currentMemo.includes(reconcileTag)) {
              row.getCell(memoCol).value = currentMemo ? `${currentMemo} ${reconcileTag}` : reconcileTag
            }
          }
          matchedSource = true
        }
      })
    }

    // --- 決済側シートの相手科目・補助科目・備考欄を更新 ---
    const settleSheet = workbook.getWorksheet(item.settleSheetName)
    if (settleSheet) {
      const stlCols = detectSheetColumns(settleSheet)
      const targetYmd = dateToYmd(new Date(item.settleDate))
      let matchedSettle = false

      settleSheet.eachRow((row, rowNumber) => {
        if (matchedSettle) return // 既に1件書き込んだらスキップ
        if (rowNumber === 1) return // ヘッダーをスキップ
        const dateVal = row.getCell(stlCols.dateCol).value
        if (!dateVal) return

        const ymd = excelDateToYmd(dateVal)
        const desc = String(row.getCell(stlCols.descCol).value || '').trim()
        let amt = 0
        if (stlCols.amountCol && !stlCols.incomeCol) {
          amt = Number(row.getCell(stlCols.amountCol).value) || 0
        } else if (stlCols.incomeCol && stlCols.expenseCol) {
          const inc = Number(row.getCell(stlCols.incomeCol).value) || 0
          const exp = Number(row.getCell(stlCols.expenseCol).value) || 0
          amt = inc > 0 ? inc : exp
        } else {
          amt = Number(row.getCell(stlCols.amountCol).value) || 0
        }

        // 既に突合済みならスキップ
        const existingMemo = String(row.getCell(stlCols.memoCol || 6).value || '')
        if (existingMemo.match(/#\d{4}/)) return

        const normDesc1 = desc.replace(/\s+/g, '')
        const normDesc2 = (item.settleDescription || '').replace(/\s+/g, '')

        if (ymd === targetYmd && amt === item.settleAmount && normDesc1 === normDesc2) {
          // 金額の更新（手動突合による差額調整）
          if (item.newSettleAmount !== undefined) {
            if (stlCols.amountCol && !stlCols.incomeCol) {
              row.getCell(stlCols.amountCol).value = item.newSettleAmount
            } else if (stlCols.incomeCol && stlCols.expenseCol) {
              const inc = Number(row.getCell(stlCols.incomeCol).value) || 0
              if (inc > 0) {
                row.getCell(stlCols.incomeCol).value = item.newSettleAmount
              } else {
                row.getCell(stlCols.expenseCol).value = item.newSettleAmount
              }
            } else if (stlCols.amountCol) {
              row.getCell(stlCols.amountCol).value = item.newSettleAmount
            }
          }

          // 勘定科目・補助科目を転記
          if (stlCols.accountCol) {
            row.getCell(stlCols.accountCol).value = item.creditAccount
          }
          if (stlCols.subAccountCol) {
            row.getCell(stlCols.subAccountCol).value = item.creditSubAccount
          }
          // 備考欄に突合Noを追記（reconcileNoがある場合のみ）
          if (reconcileTag) {
            const memoCol = stlCols.memoCol || 6
            const currentMemo = String(row.getCell(memoCol).value || '').trim()
            if (!currentMemo.includes(reconcileTag)) {
              row.getCell(memoCol).value = currentMemo ? `${currentMemo} ${reconcileTag}` : reconcileTag
            }
          }
          matchedSettle = true
        }
      })
    }

    processedCount++
  }

  // ファイル保存
  await workbook.xlsx.writeFile(excelPath)
  return processedCount
}

/**
 * 調整仕訳（決算仕訳）の型定義
 */
export interface AdjustmentEntryItem {
  date?: string
  debitAccount: string
  debitSubAccount?: string
  creditAccount: string
  creditSubAccount?: string
  amount: number
  description: string
  note?: string
}

/**
 * 仕訳帳シートに調整仕訳（決算仕訳）を追記する
 */
export async function addAdjustmentJournalEntry(
  excelPath: string,
  entry: AdjustmentEntryItem
): Promise<boolean> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)

  let sheet = workbook.getWorksheet('仕訳帳')
  if (!sheet) {
    sheet = workbook.addWorksheet('仕訳帳')
    sheet.getRow(1).values = ['日付', '借方勘定科目', '借方補助科目', '借方金額', '摘要', '貸方勘定科目', '貸方補助科目', '貸方金額', '備考']
    sheet.getRow(1).eachCell(cell => { cell.font = { bold: true } })
  }

  // 設定シートから対象年度を取得
  let year = new Date().getFullYear()
  const settingsSheet = workbook.getWorksheet('設定')
  if (settingsSheet) {
    const yearCell = settingsSheet.getRow(1).getCell(2).text.trim()
    const parsedYear = parseInt(yearCell, 10)
    if (!isNaN(parsedYear)) year = parsedYear
  }

  const safeDate = entry.date ? new Date(entry.date) : new Date(year, 11, 31, 12, 0, 0)
  safeDate.setHours(12, 0, 0, 0)

  // 実際にデータが存在する最下行を特定する
  let lastDataRow = 1
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const cell1 = row.getCell(1).value
    const cell2 = row.getCell(2).value
    const cell5 = row.getCell(5).value
    if (cell1 || cell2 || cell5) {
      if (rowNumber > lastDataRow) {
        lastDataRow = rowNumber
      }
    }
  })

  // 最下行の下に1行空行を挟んで仕訳を追記
  const targetRowIndex = lastDataRow + 2
  const nextRow = sheet.getRow(targetRowIndex)
  nextRow.getCell(1).value = safeDate
  nextRow.getCell(1).numFmt = 'YYYY/MM/DD'
  nextRow.getCell(2).value = entry.debitAccount
  nextRow.getCell(3).value = entry.debitSubAccount || null
  nextRow.getCell(4).value = entry.amount
  nextRow.getCell(4).numFmt = '#,##0'
  nextRow.getCell(5).value = entry.description || '期末残高差額調整'
  nextRow.getCell(6).value = entry.creditAccount
  nextRow.getCell(7).value = entry.creditSubAccount || null
  nextRow.getCell(8).value = entry.amount
  nextRow.getCell(8).numFmt = '#,##0'
  nextRow.getCell(9).value = entry.note || '期末残高調整'

  await workbook.xlsx.writeFile(excelPath)
  return true
}

