"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  selectFile: () => electron.ipcRenderer.invoke("select-file"),
  selectImportFiles: () => electron.ipcRenderer.invoke("select-import-files"),
  loadData: (filePath) => electron.ipcRenderer.invoke("load-data", filePath),
  importYayoiJournal: () => electron.ipcRenderer.invoke("import-yayoi-journal"),
  importYayoiBalance: () => electron.ipcRenderer.invoke("import-yayoi-balance"),
  // プラグインシステム
  getPlugins: () => electron.ipcRenderer.invoke("get-plugins"),
  parseWithPlugin: (pluginId) => electron.ipcRenderer.invoke("parse-with-plugin", pluginId),
  importWithPlugin: (pluginId, transactions) => electron.ipcRenderer.invoke("import-with-plugin", pluginId, transactions),
  // Excel転記
  writeToExcel: (excelPath, sheetName, transactions) => electron.ipcRenderer.invoke("write-to-excel", excelPath, sheetName, transactions),
  importToExcel: (pluginId) => electron.ipcRenderer.invoke("import-to-excel", pluginId),
  // 科目一括設定
  getBulkSetupStatus: () => electron.ipcRenderer.invoke("get-bulk-setup-status"),
  getAccountsWithSubs: () => electron.ipcRenderer.invoke("get-accounts-with-subs"),
  executeBulkUpdate: (params) => electron.ipcRenderer.invoke("execute-bulk-update", params),
  // 自動設定機能
  checkAutoSetup: () => electron.ipcRenderer.invoke("check-auto-setup"),
  executeAutoSetup: () => electron.ipcRenderer.invoke("execute-auto-setup"),
  // インポート画面拡張
  getImportTargets: () => electron.ipcRenderer.invoke("get-import-targets"),
  savePluginConfig: (sheetName, jsonStr) => electron.ipcRenderer.invoke("save-plugin-config", sheetName, jsonStr),
  extractTextFromFiles: (format) => electron.ipcRenderer.invoke("extract-text-from-files", format),
  previewWithJson: (jsonStr, filePaths) => electron.ipcRenderer.invoke("preview-with-json", jsonStr, filePaths),
  writeToClipboard: (text) => electron.ipcRenderer.invoke("write-to-clipboard", text),
  updateRowFields: (sheetName, searchTx, updateFields) => electron.ipcRenderer.invoke("update-row-fields", sheetName, searchTx, updateFields),
  // 突合結果のExcel書き込み
  applyReconciliation: (items) => electron.ipcRenderer.invoke("apply-reconciliation", items),
  addAdjustmentEntry: (entry) => electron.ipcRenderer.invoke("add-adjustment-entry", entry)
});
//# sourceMappingURL=preload.js.map
