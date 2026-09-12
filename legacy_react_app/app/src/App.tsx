import { useState } from 'react'
import './index.css'
import Sidebar from './components/Sidebar'
import JournalTable from './components/JournalTable'
import LedgerTable from './components/LedgerTable'
import PLReport from './components/PLReport'
import BSReport from './components/BSReport'
import VerificationPanel from './components/VerificationPanel'
import ImportPanel from './components/ImportPanel'
import BulkSetupPanel from './components/BulkSetupPanel'
import ReconciliationPanel from './components/ReconciliationPanel'

export default function App() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('journal')
  const [trialBalance, setTrialBalance] = useState<any>(null)
  const [excelPath, setExcelPath] = useState<string>('') // 読み込み中のExcelファイルパスを保持

  // Excelファイルの読み込み
  const handleSelectFile = async () => {
    // @ts-ignore
    const filePath = await window.electronAPI.selectFile()
    if (filePath) {
      setExcelPath(filePath)
      setLoading(true)
      // @ts-ignore
      const res = await window.electronAPI.loadData(filePath)
      setLoading(false)
      if (res.success) {
        setData(res.data)
      } else {
        alert('読み込みエラー: ' + res.error)
      }
    }
  }

  // データの再読み込み（一括更新後などに実行）
  const handleReloadData = async () => {
    if (!excelPath) return
    setLoading(true)
    // @ts-ignore
    const res = await window.electronAPI.loadData(excelPath)
    setLoading(false)
    if (res.success) {
      setData(res.data)
    } else {
      alert('データの再読み込みに失敗しました: ' + res.error)
    }
  }

  // やよい仕訳日記帳のインポート
  const handleImportYayoiJournal = async () => {
    setLoading(true)
    // @ts-ignore
    const res = await window.electronAPI.importYayoiJournal()
    setLoading(false)
    if (!res) return // キャンセル
    if (res.success) {
      setData(res.data)
    } else {
      alert('やよいインポートエラー: ' + res.error)
    }
  }

  // やよい残高試算表のインポート
  const handleImportYayoiBalance = async () => {
    // @ts-ignore
    const res = await window.electronAPI.importYayoiBalance()
    if (!res) return // キャンセル
    if (res.success) {
      setTrialBalance(res.data)
    } else {
      alert('残高試算表インポートエラー: ' + res.error)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto', backgroundColor: 'var(--bg-base)' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1>Dashboard</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>青色申告データ管理</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={handleSelectFile}>{loading ? 'Loading...' : 'Open Excel File'}</button>
            <button
              onClick={handleImportYayoiJournal}
              style={{ backgroundColor: '#2a5a8a' }}
            >
              やよいインポート
            </button>
          </div>
        </header>

        {!data && !loading && (
          <div style={{ textAlign: 'center', padding: '64px', backgroundColor: 'var(--bg-panel)', borderRadius: '12px', border: '1px dashed var(--border)' }}>
            <h2 style={{ marginBottom: '16px' }}>データソースを選択してください</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              「Open Excel File」で自作Excelを読み込むか、<br/>
              「やよいインポート」でやよいの仕訳日記帳を読み込めます。
            </p>
          </div>
        )}

        {data && (
          <div className="content-area">
            {activeTab === 'journal' && <JournalTable entries={data.entries} />}
            {activeTab === 'ledger' && <LedgerTable ledgers={data.ledgers} />}
             {activeTab === 'pl' && <PLReport pl={data.pl} />}
            {activeTab === 'bs' && <BSReport bs={data.bs} />}
            {activeTab === 'import' && <ImportPanel />}
            {activeTab === 'bulk-setup' && <BulkSetupPanel accounts={data.accounts} onReload={handleReloadData} />}
            {activeTab === 'reconcile' && (
              <ReconciliationPanel
                entries={data.entries}
                ledgers={data.ledgers}
                accounts={data.accounts}
                targets={data.targets}
                onReload={handleReloadData}
              />
            )}
            {activeTab === 'verify' && (
              <VerificationPanel
                ledgers={data.ledgers}
                trialBalance={trialBalance}
                onImportBalance={handleImportYayoiBalance}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
