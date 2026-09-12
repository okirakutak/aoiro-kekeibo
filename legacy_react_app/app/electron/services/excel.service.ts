import ExcelJS from 'exceljs'
import { v4 as uuidv4 } from 'uuid'
import { JournalEntry, Account } from '../../src/types/accounting'
import { PluginConfig } from '../../src/types/plugin-config'

// Excelの「設定」シートからJSON設定を読み込む
export async function loadPluginConfigsFromExcel(filePath: string): Promise<PluginConfig[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) return []

  const configs: PluginConfig[] = []

  // 3行目のヘッダーから列位置を動的に検出
  let cutoffCol = 0
  let payMonthCol = 0
  let payDayCol = 0
  let jsonCol = 7

  const headerRow = settingsSheet.getRow(3)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    if (text.includes('締') || text.includes('締め')) cutoffCol = colNum
    if (text.includes('支払月') || text.includes('引き落とし月') || text.includes('決済月')) payMonthCol = colNum
    if (text.includes('支払日') || text.includes('引き落とし日') || text.includes('決済日')) payDayCol = colNum
    if (text.includes('JSON') || text.includes('設定')) jsonCol = colNum
  })

  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return // ヘッダーをスキップ

    // 締め日・支払月・支払日の読み取り
    let cutoffDay: number | 'last' | undefined = undefined
    if (cutoffCol > 0) {
      const txt = String(row.getCell(cutoffCol).value || '').trim()
      if (txt.includes('末') || txt.toLowerCase() === 'last' || txt === '31') {
        cutoffDay = 'last'
      } else {
        const num = parseInt(txt.replace(/[^\d]/g, ''), 10)
        if (!isNaN(num) && num >= 1 && num <= 31) cutoffDay = num
      }
    }

    let paymentMonthOffset: number | undefined = undefined
    if (payMonthCol > 0) {
      const txt = String(row.getCell(payMonthCol).value || '').trim()
      if (txt.includes('翌々') || txt === '2') paymentMonthOffset = 2
      else if (txt.includes('翌') || txt === '1') paymentMonthOffset = 1
      else if (txt.includes('当') || txt === '0') paymentMonthOffset = 0
    }

    let paymentDay: number | 'last' | undefined = undefined
    if (payDayCol > 0) {
      const txt = String(row.getCell(payDayCol).value || '').trim()
      if (txt.includes('末') || txt.toLowerCase() === 'last' || txt === '31') {
        paymentDay = 'last'
      } else {
        const num = parseInt(txt.replace(/[^\d]/g, ''), 10)
        if (!isNaN(num) && num >= 1 && num <= 31) paymentDay = num
      }
    }

    const jsonStr = String(row.getCell(jsonCol > 0 ? jsonCol : 7).value || '').trim()
    if (jsonStr && (jsonStr.startsWith('{') || jsonStr.startsWith('['))) {
      try {
        const parsed = JSON.parse(jsonStr)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (cutoffDay !== undefined) item.cutoffDay = cutoffDay
          if (paymentMonthOffset !== undefined) item.paymentMonthOffset = paymentMonthOffset
          if (paymentDay !== undefined) item.paymentDay = paymentDay

          // type のフォールバック自動判定
          if (!item.type) {
            const lowerId = String(item.id || '').toLowerCase()
            const lowerName = String(item.name || '').toLowerCase()
            const lowerSheet = String(item.targetSheet || '').toLowerCase()

            if (
              lowerId.includes('card') || 
              lowerName.includes('カード') || 
              lowerSheet.includes('カード')
            ) {
              item.type = 'credit-card'
            } else if (
              lowerId.includes('bank') || 
              lowerName.includes('銀行') || 
              lowerSheet.includes('銀行')
            ) {
              item.type = 'bank'
            } else {
              item.type = 'shopping'
            }
          }
          configs.push(item)
        }
      } catch (e) {
        console.error(`Row ${rowNumber}: Invalid JSON plugin config`, e)
      }
    }
  })
  return configs
}

// シートの列位置を管理するインターフェース
export interface SheetCols {
  date: number;         // 日付列
  account: number;      // 勘定科目列
  subAccount: number;   // 補助科目列
  description: number;  // 摘要 / 項目名列
  income: number;       // 入金 / 入金額 / 収入 / 金額列
  expense: number;      // 支払 / 出金額 / 支出列
  balance: number;      // 残高列
  memo?: number;        // 備考列 (オプション)
  isSplitFormat: boolean; // 金額が2列（入金・支払）に分かれているかどうか
}

/**
 * ワークシートの1行目（ヘッダー行）をスキャンし、各列のインデックス（1始まり）を動的に検出する。
 * 補助科目の追加による列ずれや、ラベルの変更（入金/支払 → 入金額/出金額）に安全に対応します。
 */
export function detectSheetCols(sheet: ExcelJS.Worksheet): SheetCols {
  const cols: SheetCols = {
    date: 0,
    account: 0,
    subAccount: 0,
    description: 0,
    income: 0,
    expense: 0,
    balance: 0,
    memo: 0,
    isSplitFormat: false
  }

  let foundExpense = false

  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    if (text === '日付') cols.date = colNum
    // 「補助」を含まない「科目」を含む列、または「勘定科目」「相手科目」を勘定科目列とする
    if (text === '勘定科目' || text === '相手科目' || (text.includes('科目') && !text.includes('補助'))) {
      cols.account = colNum
    }
    if (text.includes('補助')) cols.subAccount = colNum
    if (text === '摘要' || text === '項目名') cols.description = colNum
    
    // 金額・入金系カラム of 検出
    if (['入金', '入金額', 'お預り金額', '収入', '収入金額', '金額', 'お支払金額', '支払金額'].includes(text)) {
      cols.income = colNum
    }
    // 出金・支払系カラムの検出
    if (['支払', '出金額', '出金', '支出', '支出金額', '払出金額'].includes(text)) {
      cols.expense = colNum
      foundExpense = true
    }
    if (text === '残高') cols.balance = colNum
    if (text === '備考') cols.memo = colNum
  })

  // 検出できなかった場合のフォールバック（デフォルト値）
  if (cols.date === 0) cols.date = 1
  if (cols.account === 0) cols.account = 2
  if (cols.subAccount === 0) cols.subAccount = 3
  if (cols.description === 0) cols.description = 4
  if (cols.income === 0) cols.income = 5
  if (cols.expense === 0) cols.expense = 6
  if (cols.balance === 0) cols.balance = 7

  // 支払・出金系の列ヘッダーが検出された、かつincome列と被っていない場合を2列構成とみなす
  cols.isSplitFormat = foundExpense && cols.income !== cols.expense

  return cols
}

// 全角・半角・カタカナ・記号・スペースの表記揺れを吸収する文字列正規化関数
export function normalizeText(str: string): string {
  if (!str) return ''

  const kanaMap: { [key: string]: string } = {
    'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
    'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
    'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
    'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
    'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
    'ｳﾞ': 'ヴ', 'ﾜﾞ': 'ヷ', 'ヰﾞ': 'ヸ', 'ヱﾞ': 'ヹ', 'ヲﾞ': 'ヺ',
    'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
    'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
    'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
    'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
    'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
    'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
    'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
    'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
    'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
    'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
    'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
    'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
    '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・',
    'ｰ': 'ー', 'ﾟ': '゜', 'ﾞ': '゛'
  }

  const reg = new RegExp(Object.keys(kanaMap).join('|'), 'g')
  let s = str.replace(reg, (match) => kanaMap[match])

  return s
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\.\-＿_\s　]/g, '')
}

// 勘定科目を読み込む
export async function loadAccounts(filePath: string): Promise<Account[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.getWorksheet('勘定科目')
  if (!sheet) return []

  const accounts: Account[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // ヘッダーはスキップ

    const id = row.getCell(1).value as number
    const name = row.getCell(2).text.trim()
    const type = row.getCell(3).text.trim() as Account['type']

    if (id && name && type) {
      accounts.push({ id, name, type })
    }
  })
  return accounts
}

// 残高不一致情報の型
export interface BalanceMismatch {
  sheetName: string;       // シート名（例: 福岡銀行）
  subAccount: string;      // 補助科目名
  settingsBalance: number; // 設定シートの繰越残高
  sheetBalance: number;    // 銀行シートから逆算した繰越残高
  settingsRow: number;     // 設定シートの行番号（修正時に使用）
}

// 銀行シートの前期繰越残高と設定シートの繰越残高を照合する
export async function checkOpeningBalances(filePath: string): Promise<BalanceMismatch[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) return []

  const mismatches: BalanceMismatch[] = []

  // 設定シートから「シート名」「勘定科目」「補助科目」「繰越残高」「行番号」を取得
  const settingsEntries: { sheetName: string; account: string; sub: string; balance: number; row: number }[] = []
  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return
    const sheetName = row.getCell(1).text.trim()
    const account = row.getCell(2).text.trim()
    const sub = row.getCell(3).text.trim()
    const balStr = row.getCell(6).text.trim() // 6列目: 繰越残高 (旧7列目)
    const balance = balStr ? parseInt(balStr.replace(/,/g, ''), 10) : 0

    if (sheetName && account) {
      settingsEntries.push({ sheetName, account, sub, balance: isNaN(balance) ? 0 : balance, row: rowNumber })
    }
  })

  // 各シートの最初の明細行から前期繰越を逆算して比較
  for (const entry of settingsEntries) {
    const sheet = workbook.getWorksheet(entry.sheetName)
    if (!sheet) continue

    // ヘッダ行から列構成を動的に検出
    const cols = detectSheetCols(sheet)

    // 入金・支払列の有無で分割フォーマットか判定
    const hasIncomeCol = sheet.getRow(1).getCell(cols.income).value !== null
    const hasExpenseCol = sheet.getRow(1).getCell(cols.expense).value !== null
    const isSplitFormat = hasIncomeCol && hasExpenseCol

    // 残高列の存在確認（「残高」ヘッダがあるシートのみチェック）
    const hasBalanceHeader = sheet.getRow(1).getCell(cols.balance).text.trim() === '残高'
    if (!hasBalanceHeader) continue // 残高列がなければチェック対象外

    // 最初の明細行を探す（2行目以降で日付または金額がある行）
    let firstDataRow: ExcelJS.Row | null = null
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r)
      const dateVal = row.getCell(cols.date).value
      const desc = row.getCell(cols.description).text.trim()

      // 「前期繰越」行はスキップ
      if (desc === '前期繰越') continue

      // 日付がある行を最初の明細行とみなす
      if (dateVal) {
        firstDataRow = row
        break
      }
    }

    if (!firstDataRow) continue

    // 最初の明細行の残高と入出金から前期繰越を逆算
    const balance = firstDataRow.getCell(cols.balance).value as number
    if (typeof balance !== 'number') continue

    let income = 0
    let expense = 0
    if (isSplitFormat) {
      const inVal = firstDataRow.getCell(cols.income).value
      const outVal = firstDataRow.getCell(cols.expense).value
      if (typeof inVal === 'number') income = inVal
      if (typeof outVal === 'number') expense = outVal
    } else {
      const val = firstDataRow.getCell(cols.income).value
      if (typeof val === 'number') expense = val
    }

    // 前期繰越 = 残高 - 入金 + 出金
    const derivedOpening = balance - income + expense

    // 設定シートの繰越残高と比較
    if (derivedOpening !== entry.balance) {
      mismatches.push({
        sheetName: entry.sheetName,
        subAccount: entry.sub || entry.sheetName,
        settingsBalance: entry.balance,
        sheetBalance: derivedOpening,
        settingsRow: entry.row
      })
    }
  }

  return mismatches
}

// 設定シートの繰越残高を更新する
export async function updateSettingsBalance(
  filePath: string,
  updates: { row: number; newBalance: number }[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) throw new Error('設定シートが見つかりません')

  for (const update of updates) {
    settingsSheet.getRow(update.row).getCell(6).value = update.newBalance
  }

  await workbook.xlsx.writeFile(filePath)
}

// 全シートから仕訳データを読み込む
export async function loadJournalEntries(filePath: string): Promise<JournalEntry[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  
  // 1. 設定シートをパース（統一テーブル形式）
  // 行1: 対象年度 | 2025
  // 行3: ヘッダ（シート名 | 勘定科目 | 補助科目名 | 決済先科目 | 決済先補助 | 検索キーワード | 繰越残高）
  // 行4～: データ行
  const settingsSheet = workbook.getWorksheet('設定')
  
  // シート読み込み対象リスト
  const targetSheets: { name: string, defaultCredit: string, defaultCreditSub?: string }[] = [
    // 現金出納帳は固定で必ず存在する
    { name: '現金出納帳', defaultCredit: '現金' }
  ]
  // 前期繰越リスト
  const initialBalances: { account: string, sub?: string, amount: number }[] = []
  let targetYear = new Date().getFullYear()
  
  if (settingsSheet) {
    // 対象年度を取得（1行目）
    const yearCell = settingsSheet.getRow(1).getCell(1).text.trim()
    if (yearCell === '対象年度') {
      const yearVal = parseInt(settingsSheet.getRow(1).getCell(2).text.trim(), 10)
      if (!isNaN(yearVal)) targetYear = yearVal
    }
    
    // 統一テーブルのデータ行をパース（4行目以降）
    settingsSheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return // 1行目=対象年度, 2行目=空, 3行目=ヘッダ
      
      const sheetName   = row.getCell(1).text.trim()
      const account     = row.getCell(2).text.trim()
      const subAccount  = row.getCell(3).text.trim()
      // const settleAcc   = row.getCell(4).text.trim()  // 将来の決済チェーン処理用
      // const settleSub   = row.getCell(5).text.trim()  // 将来の決済チェーン処理用
      // const keyword     = row.getCell(6).text.trim()  // 将来の検索キーワード処理用
      
      if (!account) return // 勘定科目が空の行はスキップ
      
      // シート名がある行 → 読み込み対象シートとして登録
      if (sheetName) {
        targetSheets.push({
          name: sheetName,
          defaultCredit: account,
          defaultCreditSub: subAccount || undefined
        })
      }
      
      // 繰越残高セル（6列目）の値を取得（数値・数式・文字列のすべてに安全に対応）
      const balanceCell = row.getCell(6)
      let amount = 0
      let hasBalance = false
      const val = balanceCell.value

      if (typeof val === 'number') {
        amount = val
        hasBalance = true
      } else if (val && typeof val === 'object' && 'result' in val && typeof val.result === 'number') {
        amount = val.result
        hasBalance = true
      } else {
        const txt = balanceCell.text ? balanceCell.text.trim() : ''
        if (txt) {
          const parsed = parseInt(txt.replace(/,/g, ''), 10)
          if (!isNaN(parsed)) {
            amount = parsed
            hasBalance = true
          }
        }
      }

      // 繰越残高の記載がある行 → 前期繰越として登録
      if (hasBalance) {
        initialBalances.push({
          account,
          sub: subAccount || undefined,
          amount
        })
      }
    })
  }

  const entries: JournalEntry[] = []

  // --- 期首残高（開始仕訳）の生成 ---
  // 1月1日付で、元入金を相手勘定とした仕訳を作る
  const openingDate = new Date(targetYear, 0, 1) // YYYY年1月1日
  for (const ib of initialBalances) {
    const isLiability = /未払金|買掛金|借入金|預り金|事業主借/.test(ib.account)
    
    entries.push({
      id: uuidv4(),
      date: openingDate,
      debitAccount: isLiability ? '元入金' : ib.account,
      debitSubAccount: isLiability ? undefined : ib.sub,
      creditAccount: isLiability ? ib.account : '元入金',
      creditSubAccount: isLiability ? ib.sub : undefined,
      amount: ib.amount,
      description: '前期繰越',
      note: '自動生成された開始仕訳',
      sourceSheet: '設定'
    })
  }

  // --- 仕訳帳のパース (借方・貸方が明記されているフォーマット) ---
  const generalJournal = workbook.getWorksheet('仕訳帳')
  if (generalJournal) {
    generalJournal.eachRow((row, rowNumber) => {
      // 1行目はヘッダとしてスキップ
      if (rowNumber === 1) return

      const dateVal = row.getCell(1).value
      const debitAcc = row.getCell(2).text.trim()
      const debitSub = row.getCell(3).text.trim()
      const debitAmt = row.getCell(4).value as number
      const desc = row.getCell(5).text.trim()
      const creditAcc = row.getCell(6).text.trim()
      const creditSub = row.getCell(7).text.trim()
      
      // データ行かどうかの判定 (日付と科目が最低限あること)
      if (!dateVal || !debitAcc || typeof debitAmt !== 'number') return

      let parsedDate = new Date()
      if (dateVal instanceof Date) {
        parsedDate = dateVal
      } else if (typeof dateVal === 'string') {
        parsedDate = new Date(dateVal)
      }

      entries.push({
        id: uuidv4(),
        date: parsedDate,
        debitAccount: debitAcc,
        debitSubAccount: debitSub || undefined,
        creditAccount: creditAcc || debitAcc, // 仮に不足している場合は借方とみなす
        creditSubAccount: creditSub || undefined,
        amount: debitAmt,
        description: desc,
        note: row.getCell(9).text,
        sourceSheet: '仕訳帳'
      })
    })
  }


  // --- その他の単式・複式混在シートパース ---
  for (const target of targetSheets) {
    // 仕訳帳は上でパース済みなので除外
    if (target.name === '仕訳帳') continue

    const sheet = workbook.getWorksheet(target.name)
    if (!sheet) continue

    // ヘッダーから列構成を動的に検出
    const cols = detectSheetCols(sheet)

    // 入金・支払列の有無で分割フォーマットか判定
    const isSplitFormat = cols.isSplitFormat
    
    // 残高列の存在確認
    const hasBalanceColumn = sheet.getRow(1).getCell(cols.balance).text.trim() === '残高'

    sheet.eachRow((row, rowNumber) => {
      // 1行目はヘッダ処理のためスキップ
      if (rowNumber === 1) return

      // 残高列があるシートで残高欄が空欄の行はスキップ（二重計上防止）
      if (hasBalanceColumn) {
        const balanceVal = row.getCell(cols.balance).value
        if (balanceVal === null || balanceVal === undefined || balanceVal === '') return
      }

      const dateVal = row.getCell(cols.date).value
      const accountName = row.getCell(cols.account).text.trim()
      const description = row.getCell(cols.description).text.trim()
      
      let amount = 0
      let isIncome = false

      if (isSplitFormat) {
        const inAmt = row.getCell(cols.income).value as number
        const outAmt = row.getCell(cols.expense).value as number
        if (typeof inAmt === 'number') {
          amount = inAmt
          isIncome = true
        } else if (typeof outAmt === 'number') {
          amount = outAmt
          isIncome = false
        } else {
          return // 金額がない行はスキップ
        }
      } else {
        const val = row.getCell(cols.income).value as number
        if (typeof val === 'number') {
          if (val < 0) {
            amount = Math.abs(val) // マイナス金額（返金・返品等）は絶対値にする
            isIncome = true        // マイナス金額は「収入（入金）」扱い
          } else {
            amount = val
            isIncome = false       // 通常のプラス金額は「支出（出金）」扱い
          }
        } else {
          return // 金額がない行はスキップ
        }
      }
      
      if (!dateVal) return

      let parsedDate = new Date()
      if (dateVal instanceof Date) {
        parsedDate = dateVal
      } else if (typeof dateVal === 'string') {
        parsedDate = new Date(dateVal)
      }

      // 補助科目を格納
      const subAccountName = row.getCell(cols.subAccount).text.trim() || undefined

      entries.push({
        id: uuidv4(),
        date: parsedDate,
        // 収入（インカム）の場合は現金や預金が「増える（借方）」、相手科目が「貸方」
        debitAccount: isIncome ? target.defaultCredit : accountName,
        debitSubAccount: isIncome ? target.defaultCreditSub : subAccountName,
        creditAccount: isIncome ? accountName : target.defaultCredit,
        creditSubAccount: isIncome ? subAccountName : target.defaultCreditSub,
        amount: amount,
        description: description,
        note: cols.memo ? row.getCell(cols.memo).text : row.getCell(cols.balance + 1).text || '', // 備考列が検出されていればそれを使用
        sourceSheet: target.name
      })
    })
  }

  // 対象年度のデータのみにフィルタリング
  const filteredEntries = entries.filter(e => e.date.getFullYear() === targetYear)

  // 日付順にソートし、同じ日付の場合は「前期繰越」仕訳を必ず最先頭にする
  return filteredEntries.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) {
      return a.date.getTime() - b.date.getTime()
    }
    const aIsOpening = a.description === '前期繰越'
    const bIsOpening = b.description === '前期繰越'
    if (aIsOpening && !bIsOpening) return -1
    if (!aIsOpening && bIsOpening) return 1
    return 0
  })
}

// =============================================
// 勘定科目・補助科目 一括設定用の新規関数
// =============================================

export interface BulkSetupSheetStatus {
  sheetName: string;
  unassignedCount: number; // 勘定科目未設定数
  totalCount: number;      // 総明細数
  unassignedDescriptions: string[]; // 勘定科目が未設定の重複排除された摘要リスト
}

/**
 * 各シートを走査し、勘定科目が未設定（空欄）の明細数や摘要の一覧を集計する
 */
export async function getBulkSetupStatus(filePath: string): Promise<BulkSetupSheetStatus[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const settingsSheet = workbook.getWorksheet('設定')
  const targetSheets: string[] = []

  if (settingsSheet) {
    settingsSheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return // 3行目まではヘッダや設定
      const sheetName = row.getCell(1).text.trim()
      const account = row.getCell(2).text.trim()
      if (sheetName && account && sheetName !== '仕訳帳') {
        if (!targetSheets.includes(sheetName)) {
          targetSheets.push(sheetName)
        }
      }
    })
  }

  // 現金出納帳は固定で追加（設定シートにない場合を考慮）
  if (!targetSheets.includes('現金出納帳')) {
    targetSheets.push('現金出納帳')
  }

  const result: any[] = []

  for (const sheetName of targetSheets) {
    const sheet = workbook.getWorksheet(sheetName)
    if (!sheet) continue

    const cols = detectSheetCols(sheet)

    let unassignedCount = 0
    let totalCount = 0
    // 摘要名 -> { income: number | null, expense: number | null }
    const itemMap = new Map<string, { income: number | null; expense: number | null }>()

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // ヘッダーはスキップ

      const dateVal = row.getCell(cols.date).value
      const account = row.getCell(cols.account).text.trim()
      const desc = row.getCell(cols.description).text.trim()

      if (!dateVal) return // 日付がない行は明細ではない
      if (desc === '前期繰越') return // 前期繰越行はスキップ

      totalCount++

      if (!account) {
        unassignedCount++
        if (desc) {
          if (!itemMap.has(desc)) {
            // 最初に見つかった未設定行の金額を登録（0円は無効扱い）
            const inVal = row.getCell(cols.income).value
            const outVal = row.getCell(cols.expense).value
            let income: number | null = null
            let expense: number | null = null

            if (cols.isSplitFormat) {
              // 2列構成シート（入出金が別の列）
              income = (typeof inVal === 'number' && inVal !== 0) ? inVal : null
              expense = (typeof outVal === 'number' && outVal !== 0) ? outVal : null
            } else {
              // 1列構成シート（クレカやショッピングサイト等）
              if (typeof inVal === 'number' && inVal !== 0) {
                if (inVal < 0) {
                  income = Math.abs(inVal) // マイナス金額は返品・返金として絶対値の「入金」にする
                } else {
                  expense = inVal          // 通常のプラス金額は「出金」にする
                }
              }
            }

            itemMap.set(desc, { income, expense })
          }
        }
      }
    })

    // 未設定数が 0 より大きいシートのみを対象とする
    if (unassignedCount > 0) {
      const unassignedItems = Array.from(itemMap.entries()).map(([description, info]) => ({
        description,
        income: info.income,
        expense: info.expense
      }))

      result.push({
        sheetName,
        unassignedCount,
        totalCount,
        unassignedItems
      })
    }
  }

  return result
}

/**
 * 「設定」シートから、勘定科目名とその勘定科目に紐づく補助科目リストの対応表を読み込む
 */
export async function loadAccountsWithSubs(filePath: string): Promise<Record<string, string[]>> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const settingsSheet = workbook.getWorksheet('設定')
  const mapping: Record<string, Set<string>> = {}

  if (settingsSheet) {
    settingsSheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return
      const account = row.getCell(2).text.trim()
      const sub = row.getCell(3).text.trim()
      if (account) {
        if (!mapping[account]) {
          mapping[account] = new Set<string>()
        }
        if (sub) {
          mapping[account].add(sub)
        }
      }
    })
  }

  const result: Record<string, string[]> = {}
  for (const acc of Object.keys(mapping)) {
    result[acc] = Array.from(mapping[acc])
  }
  return result
}

/**
 * 指定シートの同一の摘要を持つ未設定の行に対して、勘定科目と補助科目を一括設定する
 */
export async function executeBulkUpdate(
  filePath: string,
  params: {
    sheetName: string;
    description: string;
    accountName: string;
    subAccountName?: string;
  }
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const sheet = workbook.getWorksheet(params.sheetName)
  if (!sheet) throw new Error(`ワークシートが見つかりません: ${params.sheetName}`)

  const cols = detectSheetCols(sheet)

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const dateVal = row.getCell(cols.date).value
    const account = row.getCell(cols.account).text.trim()
    const desc = row.getCell(cols.description).text.trim()

    // 日付が入っており、摘要が一致し、現在の勘定科目が空欄である行が対象
    if (dateVal && desc === params.description && !account) {
      row.getCell(cols.account).value = params.accountName
      row.getCell(cols.subAccount).value = params.subAccountName || null
    }
  })

  await workbook.xlsx.writeFile(filePath)
}

// === 自動設定機能 ===

export interface AutoSetupRule {
  account: string;           // 2列目: 勘定科目
  subAccount?: string;       // 3列目: 補助科目
  targetSheets: string[];    // 4列目: 決済先シート (カンマ区切り)
  keywords: string[];        // 5列目, 6列目: 決済先補助, 検索キーワード
}

export async function loadAutoSetupRules(filePath: string): Promise<AutoSetupRule[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const settingsSheet = workbook.getWorksheet('設定')
  const rules: AutoSetupRule[] = []

  if (settingsSheet) {
    let targetSheetsCol = 4
    let settleSubCol = 5
    let keywordCol = 6

    const headerRow = settingsSheet.getRow(3)
    headerRow.eachCell((cell, colNum) => {
      const text = String(cell.value || '').trim()
      if (text.includes('決済先科目') || text === '決済先') targetSheetsCol = colNum
      if (text.includes('決済先補助')) settleSubCol = colNum
      if (text.includes('キーワード') || text.includes('検索')) keywordCol = colNum
    })

    settingsSheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return // 3行目まではヘッダー
      const account = row.getCell(2).text.trim()
      const subAccount = row.getCell(3).text.trim()
      const targetSheetsStr = row.getCell(targetSheetsCol).text.trim()
      const settleSub = row.getCell(settleSubCol).text.trim()
      const keyword = row.getCell(keywordCol).text.trim()
      
      const rawKeywordsStr = [settleSub, keyword].filter(Boolean).join(' ')
      const keywords = rawKeywordsStr ? rawKeywordsStr.split(/[,、\s　]+/).filter(Boolean) : []
      
      // 検索キーワードと勘定科目が両方存在する場合のみルールとして採用
      if (keywords.length > 0 && account) {
        const targetSheets = targetSheetsStr 
          ? targetSheetsStr.split(/[,、]/).map(s => s.trim()).filter(s => s) 
          : []
        rules.push({ account, subAccount: subAccount || undefined, targetSheets, keywords })
      }
    })
  }
  return rules
}

export async function checkAutoSetupAvailability(filePath: string): Promise<number> {
  const rules = await loadAutoSetupRules(filePath)
  if (rules.length === 0) return 0

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  let autoSetupCount = 0
  const targetSheets = workbook.worksheets.filter(s => 
    s.name !== '仕訳帳' && s.name !== '設定' && !s.name.endsWith('レポート') && s.name !== '勘定科目'
  )

  for (const sheet of targetSheets) {
    const cols = detectSheetCols(sheet)
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return

      const dateVal = row.getCell(cols.date).value
      const account = row.getCell(cols.account).text.trim()
      const desc = row.getCell(cols.description).text.trim()

      if (!dateVal || desc === '前期繰越') return

      if (desc) {
        const normDesc = normalizeText(desc)
        const normSheetName = normalizeText(sheet.name)
        // 対象シートの条件に合致し、かつ摘要にキーワードが含まれるルールを探す
        const matchedRule = rules.find(r => 
          (r.targetSheets.length === 0 || r.targetSheets.some(ts => normalizeText(ts) === normSheetName)) && 
          r.keywords.some(kw => normDesc.includes(normalizeText(kw)))
        )
        if (matchedRule) {
          const currentSub = row.getCell(cols.subAccount).text.trim()

          // 1. 勘定科目と補助科目の両方とも入力済みの場合は無視
          if (account && currentSub) return
          
          // 2. 勘定科目が入力済みで、設定と異なる場合は無視
          if (account && account !== matchedRule.account) return
          
          // 3. 勘定科目が空欄で更新が必要、または補助科目が異なっていて更新が必要な場合
          if (account !== matchedRule.account || (matchedRule.subAccount && currentSub !== matchedRule.subAccount)) {
            autoSetupCount++
          }
        }
      }
    })
  }

  return autoSetupCount
}

export async function executeAutoSetup(filePath: string): Promise<{ success: boolean; updatedCount: number }> {
  const rules = await loadAutoSetupRules(filePath)
  if (rules.length === 0) return { success: false, updatedCount: 0 }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  let updatedCount = 0
  const targetSheets = workbook.worksheets.filter(s => 
    s.name !== '仕訳帳' && s.name !== '設定' && !s.name.endsWith('レポート') && s.name !== '勘定科目'
  )

  for (const sheet of targetSheets) {
    const cols = detectSheetCols(sheet)
    let sheetUpdated = false

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return

      const dateVal = row.getCell(cols.date).value
      const account = row.getCell(cols.account).text.trim()
      const desc = row.getCell(cols.description).text.trim()

      if (!dateVal || desc === '前期繰越') return

      if (desc) {
        const normDesc = normalizeText(desc)
        const normSheetName = normalizeText(sheet.name)
        // 対象シートの条件に合致し、かつ摘要にキーワードが含まれるルールを探す
        const matchedRule = rules.find(r => 
          (r.targetSheets.length === 0 || r.targetSheets.some(ts => normalizeText(ts) === normSheetName)) && 
          r.keywords.some(kw => normDesc.includes(normalizeText(kw)))
        )
        if (matchedRule) {
          const currentSub = row.getCell(cols.subAccount).text.trim()

          // 1. 勘定科目と補助科目の両方とも入力済みの場合は無視
          if (account && currentSub) return
          
          // 2. 勘定科目が入力済みで、設定と異なる場合は無視
          if (account && account !== matchedRule.account) return

          let shouldUpdate = false

          // 3. 更新処理
          if (account !== matchedRule.account) {
            row.getCell(cols.account).value = matchedRule.account
            shouldUpdate = true
          }
          if (matchedRule.subAccount && currentSub !== matchedRule.subAccount) {
            row.getCell(cols.subAccount).value = matchedRule.subAccount
            shouldUpdate = true
          }

          if (shouldUpdate) {
            sheetUpdated = true
            updatedCount++
          }
        }
      }
    })

    if (sheetUpdated) {
      sheet.state = 'visible'
    }
  }

  if (updatedCount > 0) {
    await workbook.xlsx.writeFile(filePath)
  }

  return { success: true, updatedCount }
}

// =============================================
// AIハイブリッドインポート用の関数
// =============================================

export interface ImportTargetSheet {
  sheetName: string;
  account: string;
  subAccount?: string;
  settleSheet?: string;      // 4列目: 決済先シート名 (例: 住信SBI銀行)
  settleSub?: string;        // 5列目: 決済先補助 (例: 口座振替　ミツイスミトモカード)
  keyword?: string;          // 6列目: 検索キーワード
  searchKeywords?: string[]; // 検索キーワード配列
  hasJson: boolean;
  jsonConfig?: any;
}

export async function getImportTargets(filePath: string): Promise<ImportTargetSheet[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) return []

  const targets: ImportTargetSheet[] = []

  let cutoffCol = 0
  let payMonthCol = 0
  let payDayCol = 0
  let jsonCol = 7
  let settleCol = 4
  let settleSubCol = 5
  let keywordCol = 6

  const headerRow = settingsSheet.getRow(3)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    if (text.includes('決済先科目') || text === '決済先') settleCol = colNum
    if (text.includes('決済先補助')) settleSubCol = colNum
    if (text.includes('キーワード') || text.includes('検索')) keywordCol = colNum
    if (text.includes('締') || text.includes('締め')) cutoffCol = colNum
    if (text.includes('支払月') || text.includes('引き落とし月') || text.includes('決済月')) payMonthCol = colNum
    if (text.includes('支払日') || text.includes('引き落とし日') || text.includes('決済日')) payDayCol = colNum
    if (text.includes('JSON') || text.includes('設定')) jsonCol = colNum
  })

  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return // ヘッダーはスキップ

    const sheetName = row.getCell(1).text.trim()
    const account = row.getCell(2).text.trim()
    const subAccount = row.getCell(3).text.trim()
    const settleSheet = row.getCell(settleCol > 0 ? settleCol : 4).text.trim() || undefined
    const settleSub = row.getCell(settleSubCol > 0 ? settleSubCol : 5).text.trim() || undefined
    const keyword = row.getCell(keywordCol > 0 ? keywordCol : 6).text.trim() || undefined

    const rawKeywords = [settleSub, keyword].filter(Boolean).join(' ')
    const searchKeywords = rawKeywords ? rawKeywords.split(/[,、\s]+/).filter(Boolean) : undefined

    let cutoffDay: number | 'last' | undefined = undefined
    if (cutoffCol > 0) {
      const txt = String(row.getCell(cutoffCol).value || '').trim()
      if (txt.includes('末') || txt.toLowerCase() === 'last' || txt === '31') {
        cutoffDay = 'last'
      } else {
        const num = parseInt(txt.replace(/[^\d]/g, ''), 10)
        if (!isNaN(num) && num >= 1 && num <= 31) cutoffDay = num
      }
    }

    let paymentMonthOffset: number | undefined = undefined
    if (payMonthCol > 0) {
      const txt = String(row.getCell(payMonthCol).value || '').trim()
      if (txt.includes('翌々') || txt === '2') paymentMonthOffset = 2
      else if (txt.includes('翌') || txt === '1') paymentMonthOffset = 1
      else if (txt.includes('当') || txt === '0') paymentMonthOffset = 0
    }

    let paymentDay: number | 'last' | undefined = undefined
    if (payDayCol > 0) {
      const txt = String(row.getCell(payDayCol).value || '').trim()
      if (txt.includes('末') || txt.toLowerCase() === 'last' || txt === '31') {
        paymentDay = 'last'
      } else {
        const num = parseInt(txt.replace(/[^\d]/g, ''), 10)
        if (!isNaN(num) && num >= 1 && num <= 31) paymentDay = num
      }
    }

    const jsonStr = String(row.getCell(jsonCol > 0 ? jsonCol : 10).value || '').trim()

    if (sheetName && sheetName !== '仕訳帳') {
      let hasJson = false
      let jsonConfig: any = undefined
      if (jsonStr && (jsonStr.startsWith('{') || jsonStr.startsWith('['))) {
        try {
          let parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed = parsed[0]
          }

          if (parsed && !parsed.type) {
            const lowerId = String(parsed.id || '').toLowerCase()
            const lowerName = String(parsed.name || '').toLowerCase()
            const lowerSheet = String(sheetName || '').toLowerCase()

            if (
              lowerId.includes('card') || 
              lowerName.includes('カード') || 
              lowerSheet.includes('カード')
            ) {
              parsed.type = 'credit-card'
            } else if (
              lowerId.includes('bank') || 
              lowerName.includes('銀行') || 
              lowerSheet.includes('銀行')
            ) {
              parsed.type = 'bank'
            } else {
              parsed.type = 'shopping'
            }
          }

          jsonConfig = parsed
          hasJson = true
        } catch (e) {
          console.error(`Row ${rowNumber}: Invalid JSON plugin config`, e)
        }
      }

      if (!jsonConfig) {
        jsonConfig = {
          targetSheet: sheetName,
          name: sheetName,
          type: sheetName.includes('カード') ? 'credit-card' : (sheetName.includes('銀行') ? 'bank' : 'shopping')
        }
      }

      if (cutoffDay !== undefined) jsonConfig.cutoffDay = cutoffDay
      if (paymentMonthOffset !== undefined) jsonConfig.paymentMonthOffset = paymentMonthOffset
      if (paymentDay !== undefined) jsonConfig.paymentDay = paymentDay

      targets.push({
        sheetName,
        account,
        subAccount: subAccount || undefined,
        settleSheet,
        settleSub,
        keyword,
        searchKeywords,
        hasJson,
        jsonConfig
      })
    }
  })

  return targets
}

export async function savePluginConfig(filePath: string, sheetName: string, jsonStr: string): Promise<boolean> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const settingsSheet = workbook.getWorksheet('設定')
  if (!settingsSheet) throw new Error('設定シートが見つかりません')

  // 行3のヘッダーから「JSON」または「設定」列の位置を動的に検索
  let jsonCol = 0
  const headerRow = settingsSheet.getRow(3)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    if (text.includes('JSON') || text.includes('設定')) {
      jsonCol = colNum
    }
  })

  // ヘッダーで見つからない場合は最後の列またはデフォルト列を使用
  if (jsonCol === 0) {
    jsonCol = 10 // 3列増えた場合のデフォルト位置(J列)
  }

  let updated = false
  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return
    const name = row.getCell(1).text.trim()
    if (name === sheetName) {
      row.getCell(jsonCol).value = jsonStr
      updated = true
    }
  })

  if (updated) {
    await workbook.xlsx.writeFile(filePath)
  }
  return updated
}
