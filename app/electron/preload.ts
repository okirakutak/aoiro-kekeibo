import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectImportFiles: () => ipcRenderer.invoke('select-import-files'),
  loadData: (filePath: string) => ipcRenderer.invoke('load-data', filePath),
  importYayoiJournal: () => ipcRenderer.invoke('import-yayoi-journal'),
  importYayoiBalance: () => ipcRenderer.invoke('import-yayoi-balance'),
  // プラグインシステム
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  parseWithPlugin: (pluginId: string) => ipcRenderer.invoke('parse-with-plugin', pluginId),
  importWithPlugin: (pluginId: string, transactions: any[]) => ipcRenderer.invoke('import-with-plugin', pluginId, transactions),
  // Excel転記
  writeToExcel: (excelPath: string, sheetName: string, transactions: any[]) => ipcRenderer.invoke('write-to-excel', excelPath, sheetName, transactions),
  importToExcel: (pluginId: string) => ipcRenderer.invoke('import-to-excel', pluginId),
  // 科目一括設定
  getBulkSetupStatus: () => ipcRenderer.invoke('get-bulk-setup-status'),
  getAccountsWithSubs: () => ipcRenderer.invoke('get-accounts-with-subs'),
  executeBulkUpdate: (params: { sheetName: string, description: string, accountName: string, subAccountName?: string }) => ipcRenderer.invoke('execute-bulk-update', params),
  // 自動設定機能
  checkAutoSetup: () => ipcRenderer.invoke('check-auto-setup'),
  executeAutoSetup: () => ipcRenderer.invoke('execute-auto-setup'),
  // インポート画面拡張
  getImportTargets: () => ipcRenderer.invoke('get-import-targets'),
  savePluginConfig: (sheetName: string, jsonStr: string) => ipcRenderer.invoke('save-plugin-config', sheetName, jsonStr),
  extractTextFromFiles: (format: 'html' | 'csv') => ipcRenderer.invoke('extract-text-from-files', format),
  previewWithJson: (jsonStr: string, filePaths: string[]) => ipcRenderer.invoke('preview-with-json', jsonStr, filePaths),
  writeToClipboard: (text: string) => ipcRenderer.invoke('write-to-clipboard', text),
  updateRowFields: (sheetName: string, searchTx: { date: string; description: string; amount: number }, updateFields: { amount?: number; memo?: string }) => ipcRenderer.invoke('update-row-fields', sheetName, searchTx, updateFields),
  // 突合結果のExcel書き込み
  applyReconciliation: (items: any[]) => ipcRenderer.invoke('apply-reconciliation', items),
})
