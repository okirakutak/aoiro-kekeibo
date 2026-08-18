import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import { join, dirname } from 'node:path'
import { convert } from 'html-to-text'
import fs from 'fs'
import { loadAccounts, loadJournalEntries, checkOpeningBalances, updateSettingsBalance, loadPluginConfigsFromExcel, getBulkSetupStatus, loadAccountsWithSubs, executeBulkUpdate, checkAutoSetupAvailability, executeAutoSetup, getImportTargets, savePluginConfig } from './services/excel.service'
import { generateLedgers, generatePL, generateBS } from './services/accounting.service'
import { importYayoiJournal, importYayoiTrialBalance } from './services/yayoi.service'
import { pluginManager } from './services/plugin-manager'
import { parseFiles, createPluginFromConfig } from './services/config-parser-engine'
import { writeTransactionsToSheet, updateRowFields, applyReconciliation } from './services/excel-writer.service'

// ※ プラグインのJSON設定はExcelの「設定」シートから動的に読み込むように移行しました

process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

let win: BrowserWindow | null
let lastExcelPath: string | null = null // 最後に読み込んだExcelファイルのパスを保持
let lastOpenDir: string | null = null   // 最後に開いたファイルの親フォルダ

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    icon: join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // ==========================================
  // IPC通信: ファイル読み込みのハンドラ登録
  // ==========================================
  ipcMain.handle('select-file', async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
      defaultPath: lastOpenDir || undefined
    })
    if (canceled) return null
    lastOpenDir = dirname(filePaths[0])
    return filePaths[0]
  })

  ipcMain.handle('select-import-files', async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      defaultPath: lastOpenDir || undefined
    })
    if (canceled || filePaths.length === 0) return null
    lastOpenDir = dirname(filePaths[0])
    return filePaths
  })

  ipcMain.handle('load-data', async (_, filePath: string) => {
    try {
      // --- 残高チェック（銀行シートと設定シートの照合） ---
      const mismatches = await checkOpeningBalances(filePath)
      
      if (mismatches.length > 0) {
        // 不一致の詳細メッセージを構築
        const details = mismatches.map(m =>
          `${m.sheetName}（${m.subAccount}）:\n` +
          `  設定シート: ${m.settingsBalance.toLocaleString()}円\n` +
          `  銀行シート: ${m.sheetBalance.toLocaleString()}円\n` +
          `  差額: ${(m.sheetBalance - m.settingsBalance).toLocaleString()}円`
        ).join('\n\n')

        // ダイアログで確認
        const result = await dialog.showMessageBox(win!, {
          type: 'warning',
          title: '前期繰越残高の不一致',
          message: `${mismatches.length}件の前期繰越残高が銀行シートのデータと一致しません。`,
          detail: details + '\n\n設定シートの繰越残高を銀行シートの値に修正しますか？',
          buttons: ['修正して続行', '修正せず中止'],
          defaultId: 0,
          cancelId: 1
        })

        if (result.response === 0) {
          // 設定シートの繰越残高を銀行シートの値で更新
          const updates = mismatches.map(m => ({
            row: m.settingsRow,
            newBalance: m.sheetBalance
          }))
          await updateSettingsBalance(filePath, updates)
        } else {
          // ユーザーが中止を選択
          return {
            success: false,
            error: '前期繰越残高の不一致により、データ読み込みを中止しました。\n設定シートの繰越残高を確認してください。'
          }
        }
      }

      // --- 通常のデータ読み込み ---
      lastExcelPath = filePath // Excelファイルのパスを記録
      
      // プラグイン設定をExcelから読み込んで登録
      const pluginConfigs = await loadPluginConfigsFromExcel(filePath)
      pluginManager.clear()
      for (const config of pluginConfigs) {
        pluginManager.register(createPluginFromConfig(config))
        console.log(`プラグイン登録 (Excelから): ${config.name} (${config.id})`)
      }

      const accounts = await loadAccounts(filePath)
      const entries = await loadJournalEntries(filePath)
      const ledgers = generateLedgers(entries)
      const pl = generatePL(ledgers, accounts)
      const bs = generateBS(ledgers, pl.netIncome, accounts)
      const targets = await getImportTargets(filePath) // 設定シート情報の取得

      return {
        success: true,
        data: { accounts, entries, ledgers, pl, bs, targets }
      }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // やよい仕訳日記帳のインポート
  ipcMain.handle('import-yayoi-journal', async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'やよいエクスポート', extensions: ['txt'] }]
    })
    if (canceled) return null
    try {
      const entries = importYayoiJournal(filePaths[0])

      // Excelファイルが読み込み済みの場合、設定シートの前期繰越仕訳をマージ
      if (lastExcelPath) {
        const excelEntries = await loadJournalEntries(lastExcelPath)
        const openingEntries = excelEntries.filter(e => e.description === '前期繰越')
        entries.push(...openingEntries)
      }

      const ledgers = generateLedgers(entries)
      const pl = generatePL(ledgers)
      const bs = generateBS(ledgers, pl.netIncome)
      return {
        success: true,
        data: { entries, ledgers, pl, bs }
      }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // やよい残高試算表のインポート
  ipcMain.handle('import-yayoi-balance', async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'やよいエクスポート', extensions: ['txt'] }]
    })
    if (canceled) return null
    try {
      const trialBalance = importYayoiTrialBalance(filePaths[0])
      return { success: true, data: trialBalance }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // === インポート画面拡張 API ===
  
  ipcMain.handle('get-import-targets', async () => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません' }
    try {
      const targets = await getImportTargets(lastExcelPath)
      return { success: true, data: targets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('save-plugin-config', async (_, sheetName: string, jsonStr: string) => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません' }
    try {
      await savePluginConfig(lastExcelPath, sheetName, jsonStr)
      // プラグインマネージャの再読み込み
      const pluginConfigs = await loadPluginConfigsFromExcel(lastExcelPath)
      pluginManager.clear()
      for (const config of pluginConfigs) {
        pluginManager.register(createPluginFromConfig(config))
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('preview-with-json', async (_, jsonStr: string, filePaths: string[]) => {
    try {
      const config = JSON.parse(jsonStr)
      const cfg = Array.isArray(config) ? config[0] : config
      const plugin = createPluginFromConfig(cfg)
      const transactions = await parseFiles(cfg, filePaths)
      const entries = plugin.toJournalEntries(transactions)
      return { success: true, data: { transactions, entries } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('write-to-clipboard', (_, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('extract-text-from-files', async (_, format: 'html' | 'csv') => {
    if (!win) return null
    const filters = format === 'html' 
      ? [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
      : [{ name: 'CSV/TSV Files', extensions: ['csv', 'tsv', 'txt'] }]
    
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', format === 'html' ? 'multiSelections' : 'openFile'],
      filters,
      defaultPath: lastOpenDir || undefined
    })
    
    if (canceled || filePaths.length === 0) return null
    lastOpenDir = dirname(filePaths[0])

    try {
      let combinedText = ''
      for (const fp of filePaths) {
        if (combinedText.length > 50000) break // 既に十分な文字数がある場合は以降のファイルをスキップ
        const raw = fs.readFileSync(fp, 'utf-8')
        if (format === 'html') {
          // ブラウザでテキストをコピーした状態に近付けるために変換
          const text = convert(raw, {
            wordwrap: false, // 勝手な改行を防ぐ
            selectors: [
              { selector: 'a', options: { ignoreHref: true } }, // URLを抽出しない
              { selector: 'img', format: 'skip' }, // 画像をスキップ
              { selector: 'nav', format: 'skip' }, // ナビゲーションをスキップ
              { selector: 'footer', format: 'skip' }
            ]
          })
          combinedText += `\n--- File: ${require('node:path').basename(fp)} ---\n` + text + '\n'
        } else {
          combinedText += `\n--- File: ${require('node:path').basename(fp)} ---\n` + raw + '\n'
        }
      }
      
      // クリップボードとAI側のトークン限界を考慮し、最大4万文字で切り捨てる
      if (combinedText.length > 40000) {
        combinedText = combinedText.substring(0, 40000) + '\n\n...（データサイズが非常に大きいため、JSON構造解析用に先頭の一部のみを抽出しました）'
      }

      return { success: true, data: combinedText, filePaths }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // === プラグインシステム ===

  // プラグイン一覧を取得
  ipcMain.handle('get-plugins', async () => {
    try {
      const list = pluginManager.getPluginList()
      return { success: true, data: list }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // プラグインでファイルをパース（プレビュー用、複数ファイル対応）
  ipcMain.handle('parse-with-plugin', async (_, pluginId: string) => {
    if (!win) return null
    const plugin = pluginManager.getPlugin(pluginId)
    if (!plugin) return { success: false, error: `プラグインが見つかりません: ${pluginId}` }

    // multiFile対応: 登録されているプラグインの設定を参照する
    // (configはpluginのプロパティには無いので、ExcelからのPluginConfigリストは保持していない。
    // 現状PluginInfoにmultiFileを持たせるか、一旦ここでは単一ファイルとして扱う)
    // TODO: プラグインの複数ファイル対応が必要なら ImportPlugin インターフェースを拡張する
    const isMultiFile = false // 一旦 false に固定

    const filters = [
        {
          name: 'All Files (*.*)',
          extensions: ['*']
        },
        {
          name: `${plugin.name} (${plugin.supportedExtensions.map(e => `*.${e}`).join(', ')})`,
          extensions: plugin.supportedExtensions
        }
      ]

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: isMultiFile ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: process.platform === 'linux' ? undefined : filters
    })
    if (canceled || filePaths.length === 0) return null
    try {
      let transactions
      // JSON設定からconfigを取得
      let config = undefined
      if (lastExcelPath) {
        const allConfigs = await loadPluginConfigsFromExcel(lastExcelPath)
        config = allConfigs.find(c => c.id === pluginId)
      }
      
      if (config) {
        // JSON設定ベースのプラグイン: 複数ファイル一括パース
        transactions = await parseFiles(config, filePaths)
      } else {
        // ビルトインプラグイン: 1ファイルずつパース
        transactions = await pluginManager.parseFile(pluginId, filePaths[0])
      }
      return { success: true, data: transactions }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // プラグインで取引明細を仕訳データに変換してインポート
  ipcMain.handle('import-with-plugin', async (_, pluginId: string, transactions: any[]) => {
    try {
      // 取引明細の日付をDateオブジェクトに復元（IPC通信で文字列化されるため）
      const restored = transactions.map(tx => ({
        ...tx,
        date: new Date(tx.date)
      }))
      const entries = pluginManager.convertToJournalEntries(pluginId, restored)
      return { success: true, data: entries }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // Excel転記: パースした取引データをExcelワークシートに書き込む
  ipcMain.handle('write-to-excel', async (_, _excelPath: string, sheetName: string, transactions: any[]) => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません' }
    try {
      const restored = transactions.map(tx => ({
        ...tx,
        date: new Date(tx.date)
      }))
      const count = await writeTransactionsToSheet(lastExcelPath, sheetName, restored)
      return { success: true, data: { count } }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // Excel行の金額・備考を更新する
  ipcMain.handle('update-row-fields', async (_, sheetName: string, searchTx: { date: string; description: string; amount: number }, updateFields: { amount?: number; memo?: string }) => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません' }
    try {
      const success = await updateRowFields(lastExcelPath, sheetName, {
        ...searchTx,
        date: new Date(searchTx.date)
      }, updateFields)
      return { success }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // === 科目一括設定関連 ===

  // 未設定明細の集計情報を取得
  ipcMain.handle('get-bulk-setup-status', async () => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      const status = await getBulkSetupStatus(lastExcelPath)
      return { success: true, data: status }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // 勘定科目と補助科目の対応関係マッピングを取得
  ipcMain.handle('get-accounts-with-subs', async () => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      const mapping = await loadAccountsWithSubs(lastExcelPath)
      return { success: true, data: mapping }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // 同一摘要の未設定行に対して一括設定を実行
  ipcMain.handle('execute-bulk-update', async (_, params: { sheetName: string, description: string, accountName: string, subAccountName?: string }) => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      await executeBulkUpdate(lastExcelPath, params)
      return { success: true }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // --- 自動設定機能 ---
  ipcMain.handle('check-auto-setup', async () => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      const count = await checkAutoSetupAvailability(lastExcelPath)
      return { success: true, data: count }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('execute-auto-setup', async () => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      const result = await executeAutoSetup(lastExcelPath)
      return { success: true, data: result }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // 突合結果をExcelに書き込む
  ipcMain.handle('apply-reconciliation', async (_, items: any[]) => {
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。' }
    try {
      const count = await applyReconciliation(lastExcelPath, items)
      return { success: true, data: { count } }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  // ファイル選択→パース→Excel転記を一括で実行
  ipcMain.handle('import-to-excel', async (_, pluginId: string) => {
    if (!win) return { success: false, error: 'ウィンドウが見つかりません' }
    if (!lastExcelPath) return { success: false, error: 'Excelファイルが読み込まれていません。先に「Open Excel File」でExcelファイルを読み込んでください。' }

    const plugin = pluginManager.getPlugin(pluginId)
    if (!plugin) return { success: false, error: `プラグインが見つかりません: ${pluginId}` }

    // JSON設定からtargetSheetを取得
    const allConfigs = await loadPluginConfigsFromExcel(lastExcelPath)
    const config = allConfigs.find(c => c.id === pluginId)
    const targetSheet = config?.targetSheet || plugin.name

    // ファイル選択ダイアログ（常に複数ファイル選択を許可）
    const filters = [
        {
          name: 'All Files (*.*)',
          extensions: ['*']
        },
        {
          name: `${plugin.name} (${plugin.supportedExtensions.map(e => `*.${e}`).join(', ')})`,
          extensions: plugin.supportedExtensions
        }
      ]

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: `${plugin.name}ファイルを選択してください`,
      properties: ['openFile', 'multiSelections'],
      filters: process.platform === 'linux' ? undefined : filters,
      defaultPath: lastOpenDir || undefined
    })
    if (canceled || filePaths.length === 0) return null
    lastOpenDir = dirname(filePaths[0])

    try {
      // パース（JSON設定・ビルトインを問わず全ファイルを一括処理）
      let transactions: any[]
      if (config) {
        // JSON設定ベースのプラグイン: 全ファイルを一括パース＋残高チェーンソート
        transactions = await parseFiles(config, filePaths)
      } else {
        // ビルトインプラグイン: 全ファイルを順にパースして結合
        const allTx = []
        for (const fp of filePaths) {
          const tx = await pluginManager.parseFile(pluginId, fp)
          allTx.push(...tx)
        }
        // 日付昇順でソート
        allTx.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        transactions = allTx
      }

      if (transactions.length === 0) {
        return { success: false, error: '取引データが見つかりませんでした。ファイルの形式を確認してください。' }
      }

      // Excel転記（レイアウト種別と前期繰越行の有無を設定から取得）
      const sheetLayout = config?.sheetLayout || 'bank'
      const hasOpeningBalance = config?.hasOpeningBalance
      const count = await writeTransactionsToSheet(lastExcelPath, targetSheet, transactions, sheetLayout, hasOpeningBalance)

      return {
        success: true,
        data: {
          count,
          sheetName: targetSheet,
          excelPath: lastExcelPath
        }
      }
    } catch (error: any) {
      console.error(error)
      return { success: false, error: error.message }
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(join(process.env.DIST || '', 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
