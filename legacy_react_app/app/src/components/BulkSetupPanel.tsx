import { useState, useEffect, useRef } from 'react'
import { Account } from '../types/accounting'

// バックエンドから返される摘要ごとの金額情報を含む型
interface BulkSetupItem {
  description: string;
  income: number | null;
  expense: number | null;
}

// バックエンドから返される集計データの型
interface BulkSetupSheetStatus {
  sheetName: string;
  unassignedCount: number;
  totalCount: number;
  unassignedItems: BulkSetupItem[];
}

interface BulkSetupPanelProps {
  accounts: Account[]; // 勘定科目マスタ
  onReload: () => Promise<void>; // 実行完了後のデータ再ロード用コールバック
}

// 各行のレイアウトスタイルを定義（ヘッダー・閉じた表示・リストアイテムで共通化）
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  boxSizing: 'border-box'
}
const descColStyle: React.CSSProperties = {
  flex: '1',
  minWidth: '200px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left'
}
const incomeColStyle: React.CSSProperties = {
  width: '120px',
  textAlign: 'right',
  boxSizing: 'border-box'
}
const expenseColStyle: React.CSSProperties = {
  width: '120px',
  textAlign: 'right',
  boxSizing: 'border-box'
}
const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '14px',
  backgroundColor: 'var(--border)',
  margin: '0 16px',
  flexShrink: 0
}

export default function BulkSetupPanel({ accounts, onReload }: BulkSetupPanelProps) {
  const [sheets, setSheets] = useState<BulkSetupSheetStatus[]>([])
  const [selectedSheetName, setSelectedSheetName] = useState<string>('')
  const [unassignedItems, setUnassignedItems] = useState<BulkSetupItem[]>([])
  const [selectedDesc, setSelectedDesc] = useState<string>('')
  const [accountSubs, setAccountSubs] = useState<Record<string, string[]>>({})
  
  // 選択中の仕訳設定
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [selectedSub, setSelectedSub] = useState<string>('')
  
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  
  // 自動設定可能な件数
  const [autoSetupCount, setAutoSetupCount] = useState(0)
  
  // カスタムドロップダウンの開閉状態
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 初期ロード：未設定シート一覧と補助科目マッピングを取得
  const fetchStatus = async () => {
    setLoading(true)
    try {
      // @ts-ignore
      const resStatus = await window.electronAPI.getBulkSetupStatus()
      // @ts-ignore
      const resSubs = await window.electronAPI.getAccountsWithSubs()
      // @ts-ignore
      const autoRes = await window.electronAPI.checkAutoSetup()

      if (autoRes && autoRes.success) {
        setAutoSetupCount(autoRes.data)
      }

      if (resStatus && resStatus.success) {
        setSheets(resStatus.data)
        
        // 既に選択中のシートがある場合は保持し、無ければ最初のシートを選択
        if (resStatus.data.length > 0) {
          const stillExists = resStatus.data.some((s: any) => s.sheetName === selectedSheetName)
          if (!stillExists) {
            setSelectedSheetName(resStatus.data[0].sheetName)
            setUnassignedItems(resStatus.data[0].unassignedItems)
            setSelectedDesc('')
          } else {
            const currentSheet = resStatus.data.find((s: any) => s.sheetName === selectedSheetName)
            setUnassignedItems(currentSheet ? currentSheet.unassignedItems : [])
          }
        } else {
          setSelectedSheetName('')
          setUnassignedItems([])
          setSelectedDesc('')
        }
      }
      if (resSubs && resSubs.success) {
        setAccountSubs(resSubs.data)
      }
    } catch (err: any) {
      console.error(err)
      alert('初期データの読み込みに失敗しました: ' + err.message)
    } finally {
      fetchStatusDropdownCleanup()
      setLoading(false)
    }
  };

  const fetchStatusDropdownCleanup = () => {
    setIsOpen(false)
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  // ドロップダウンの外側をクリックしたときに閉じる処理
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // ワークシート選択変更時のハンドラ
  const handleSheetChange = (sheetName: string) => {
    setSelectedSheetName(sheetName)
    setSelectedDesc('')
    setIsOpen(false)
    const sheet = sheets.find(s => s.sheetName === sheetName)
    if (sheet) {
      setUnassignedItems(sheet.unassignedItems)
    } else {
      setUnassignedItems([])
    }
  }

  // 勘定科目選択変更時のハンドラ (補助科目リストの動的制御)
  const handleAccountChange = (accountName: string) => {
    setSelectedAccount(accountName)
    setSelectedSub('') // 補助科目をリセット
  }

  // 一括設定実行処理
  const handleExecute = async () => {
    if (!selectedSheetName || !selectedDesc || !selectedAccount) {
      alert('ワークシート、対象摘要、勘定科目を選択してください。')
      return
    }

    setExecuting(true)
    try {
      // @ts-ignore
      const res = await window.electronAPI.executeBulkUpdate({
        sheetName: selectedSheetName,
        description: selectedDesc,
        accountName: selectedAccount,
        subAccountName: selectedSub || undefined
      })

      if (res && res.success) {
        alert(`✅ 「${selectedDesc}」の一括設定が完了しました。`)
        
        // 全体の仕訳データを再ロード
        await onReload()

        // 選択された摘要をリセットして再取得
        setSelectedDesc('')
        await fetchStatus()
      } else {
        alert('❌ 設定の更新に失敗しました: ' + res.error)
      }
    } catch (err: any) {
      alert('❌ エラーが発生しました: ' + err.message)
    } finally {
      setExecuting(false)
    }
  }

  // 自動設定実行処理
  const handleExecuteAutoSetup = async () => {
    setExecuting(true)
    try {
      // @ts-ignore
      const res = await window.electronAPI.executeAutoSetup()
      if (res && res.success) {
        alert(`設定シートのルールに基づき、${res.data.updatedCount}件の明細を自動設定しました。`)
        await fetchStatus() // 再読み込み
        await onReload()
      } else {
        alert('自動設定に失敗しました: ' + (res?.error || 'Unknown error'))
      }
    } catch (err: any) {
      console.error(err)
      alert('自動設定中にエラーが発生しました: ' + err.message)
    } finally {
      setExecuting(false)
    }
  }

  // 選択された勘定科目の補助科目リストを取得
  const currentSubList = accountSubs[selectedAccount] || []
  const hasSubAccounts = currentSubList.length > 0

  // 現在選択されている摘要アイテムを探す
  const selectedItem = unassignedItems.find(i => i.description === selectedDesc)

  // 選択された摘要の入金/出金タイプに応じて勘定科目を絞り込み、推奨順にソートする
  const getFilteredAccounts = () => {
    if (!selectedItem) return accounts

    const isIncome = selectedItem.income !== null && selectedItem.income > 0
    const isExpense = selectedItem.expense !== null && selectedItem.expense > 0

    if (isIncome) {
      // 入金明細の選択時: 費用区分は完全に除外する
      const allowed = accounts.filter(acc => acc.type !== '費用')
      
      // 推奨度スコアを付与してソート
      return allowed.map(acc => {
        let score = 0
        if (acc.name === '売上高' || acc.name === '売掛金' || acc.name === '雑収入') {
          score = 100 // 最優先
        } else if (acc.name === '事業主借') {
          score = 80  // 準優先
        } else if (acc.type === '収益') {
          score = 60
        } else if (acc.type === '資本' || acc.type === '負債') {
          score = 40
        } else {
          score = 20  // その他（資産など）
        }
        return { acc, score }
      })
      .sort((a, b) => b.score - a.score || a.acc.id - b.acc.id)
      .map(x => x.acc)
    }

    if (isExpense) {
      // 出金明細の選択時: 収益区分は完全に除外する
      const allowed = accounts.filter(acc => acc.type !== '収益')
      
      // 推奨度スコアを付与してソート
      return allowed.map(acc => {
        let score = 0
        if (acc.type === '費用') {
          score = 100 // 最優先（頻出する経費科目全般）
        } else if (acc.name === '事業主貸' || acc.name === '未払金') {
          score = 80  // 準優先
        } else if (acc.type === '負債' || acc.type === '資本') {
          score = 60
        } else if (acc.name === '工具器具備品' || acc.name === '車両運搬具') {
          score = 50  // 備品購入
        } else {
          score = 20  // その他
        }
        return { acc, score }
      })
      .sort((a, b) => b.score - a.score || a.acc.id - b.acc.id)
      .map(x => x.acc)
    }

    return accounts
  }

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>🏷️ 勘定科目・補助科目 一括設定</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem' }}>
        インポートした明細の相手勘定（借方/貸方）が未設定になっている箇所を、同じ摘要ごとに一括で登録します。
      </p>

      {autoSetupCount > 0 && (
        <div style={{
          padding: '24px',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          marginBottom: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚡</span>
            <span>「設定」シートに基づく自動設定可能な明細が {autoSetupCount} 件見つかりました。</span>
          </div>
          <button
            onClick={handleExecuteAutoSetup}
            disabled={executing}
            style={{
              padding: '12px 32px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: executing ? 'not-allowed' : 'pointer',
              opacity: executing ? 0.7 : 1,
              transition: 'background-color 0.2s',
              boxShadow: '0 4px 6px rgba(59, 130, 246, 0.2)'
            }}
          >
            {executing ? '処理中...' : '自動設定を実行する'}
          </button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
          <p>データを集計中...</p>
        </div>
      )}

      {!loading && sheets.length === 0 && (
        <div style={{
          backgroundColor: 'var(--bg-panel)',
          borderRadius: '12px',
          padding: '48px',
          border: '1px solid var(--border)',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          <p>🎉 現在、勘定科目が未設定の明細はありません（すべての明細に科目が設定されています）。</p>
        </div>
      )}

      {!loading && sheets.length > 0 && (
        <div style={{
          backgroundColor: 'var(--bg-panel)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          pointerEvents: autoSetupCount > 0 ? 'none' : 'auto',
          opacity: autoSetupCount > 0 ? 0.4 : 1,
          transition: 'opacity 0.3s'
        }}>
          {/* 上下縦並びのレイアウト構成 */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
          }}>
            
            {/* 上部セクション: 対象選択エリア */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* ワークシート選択ドロップダウン */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  ワークシートの選択
                </label>
                <select
                  value={selectedSheetName}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-base)',
                    color: 'var(--text-primary)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  {sheets.map(s => (
                    <option key={s.sheetName} value={s.sheetName}>
                      {s.sheetName} (未設定: {s.unassignedCount} / 全 {s.totalCount} 件)
                    </option>
                  ))}
                </select>
              </div>

              {/* 対象摘要選択カスタムドロップダウン */}
              <div ref={dropdownRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                <label style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  対象の摘要を選択（未設定のみ・重複排除済）
                </label>
                
                {/* 1. ラベルヘッダー（フレックス配置で幅を完全一致） */}
                <div style={{
                  display: 'flex',
                  padding: '10px 16px',
                  fontWeight: 'bold',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-base)',
                  border: '1px solid var(--border)',
                  borderBottom: 'none',
                  borderRadius: '8px 8px 0 0',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box'
                }}>
                  <div style={rowStyle}>
                    <div style={descColStyle}>摘要</div>
                    <div style={dividerStyle} />
                    <div style={incomeColStyle}>入金額</div>
                    <div style={dividerStyle} />
                    <div style={expenseColStyle}>出金額</div>
                    {/* ドロップダウン矢印分の幅をヘッダーの末尾にダミーで確保 */}
                    <div style={{ width: '20px', marginLeft: '12px' }} />
                  </div>
                </div>

                {/* 2. カスタムセレクトボックス（閉じた状態の表示） */}
                <div
                  onClick={() => setIsOpen(!isOpen)}
                  style={{
                    display: 'flex',
                    padding: '12px 16px',
                    borderRadius: isOpen ? '0' : '0 0 8px 8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-base)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxSizing: 'border-box',
                    userSelect: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                >
                  {selectedItem ? (
                    <div style={rowStyle}>
                      <div style={descColStyle}>{selectedItem.description || '(摘要なし)'}</div>
                      <div style={dividerStyle} />
                      <div style={incomeColStyle}>
                        {selectedItem.income !== null ? `${selectedItem.income.toLocaleString()}円` : ''}
                      </div>
                      <div style={dividerStyle} />
                      <div style={expenseColStyle}>
                        {selectedItem.expense !== null ? `${selectedItem.expense.toLocaleString()}円` : ''}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>-- 対象の摘要を選択してください --</span>
                  )}
                  {/* ネイティブ風矢印 */}
                  <span style={{ marginLeft: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', userSelect: 'none' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {/* 3. ドロップダウン展開リスト（開いた状態の表示） */}
                {isOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: '0',
                    right: '0',
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxSizing: 'border-box'
                  }}>
                    {unassignedItems.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedDesc(item.description)
                          setIsOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          padding: '12px 16px',
                          cursor: 'pointer',
                          backgroundColor: selectedDesc === item.description ? 'var(--bg-hover)' : 'transparent',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '0.95rem',
                          color: selectedDesc === item.description ? 'var(--accent)' : 'var(--text-primary)',
                          transition: 'background-color 0.1s ease',
                          boxSizing: 'border-box'
                        }}
                        onMouseEnter={(e) => {
                          if (selectedDesc !== item.description) {
                            e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedDesc !== item.description) {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }
                        }}
                      >
                        <div style={rowStyle}>
                          <div style={{
                            ...descColStyle,
                            fontWeight: selectedDesc === item.description ? 'bold' : 'normal'
                          }}>
                            {item.description || '(摘要なし)'}
                          </div>
                          <div style={dividerStyle} />
                          <div style={{
                            ...incomeColStyle,
                            fontWeight: selectedDesc === item.description ? 'bold' : 'normal'
                          }}>
                            {item.income !== null ? `${item.income.toLocaleString()}円` : ''}
                          </div>
                          <div style={dividerStyle} />
                          <div style={{
                            ...expenseColStyle,
                            fontWeight: selectedDesc === item.description ? 'bold' : 'normal'
                          }}>
                            {item.expense !== null ? `${item.expense.toLocaleString()}円` : ''}
                          </div>
                        </div>
                        {/* 位置同期用右端スペース（矢印幅に合わせる） */}
                        <div style={{ width: '20px', marginLeft: '12px' }} />
                      </div>
                    ))}
                    {unassignedItems.length === 0 && (
                      <div style={{ padding: '24px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                        未設定の摘要はありません。
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* 下部セクション: 科目設定エリア */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-base)',
              padding: '24px'
            }}>
              <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '4px' }}>
                科目の設定
              </h3>

              {/* 選択された摘要のプレビュー */}
              <div style={{ fontSize: '0.95rem' }}>
                対象摘要: <strong style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{selectedDesc || '選択してください'}</strong>
              </div>

              {/* 勘定科目・補助科目の横並び入力グリッド */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '20px'
              }}>
                {/* 勘定科目選択 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    勘定科目
                  </label>
                  <select
                    value={selectedAccount}
                    onChange={(e) => handleAccountChange(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      fontSize: '1rem',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">-- 選択してください --</option>
                    {getFilteredAccounts().map(acc => (
                      <option key={acc.id} value={acc.name}>
                        {acc.name} ({acc.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 補助科目選択 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{
                    fontWeight: 'bold',
                    color: hasSubAccounts ? 'var(--text-secondary)' : '#888',
                    fontSize: '0.9rem'
                  }}>
                    補助科目 {!hasSubAccounts && selectedAccount && ' (補助科目の設定がありません)'}
                  </label>
                  <select
                    value={selectedSub}
                    onChange={(e) => setSelectedSub(e.target.value)}
                    disabled={!hasSubAccounts}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: hasSubAccounts ? 'var(--bg-panel)' : '#333',
                      color: hasSubAccounts ? 'var(--text-primary)' : '#888',
                      fontSize: '1rem',
                      cursor: hasSubAccounts ? 'pointer' : 'not-allowed'
                    }}
                  >
                    <option value="">-- 指定なし --</option>
                    {currentSubList.map((sub, idx) => (
                      <option key={idx} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 実行ボタンの配置 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  onClick={handleExecute}
                  disabled={executing || !selectedSheetName || !selectedDesc || !selectedAccount}
                  style={{
                    padding: '12px 32px',
                    backgroundColor: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: (executing || !selectedSheetName || !selectedDesc || !selectedAccount) ? 'not-allowed' : 'pointer',
                    fontSize: '1.05rem',
                    fontWeight: 'bold',
                    opacity: (executing || !selectedSheetName || !selectedDesc || !selectedAccount) ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  {executing ? '更新中...' : '勘定科目を一括設定する'}
                </button>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  )
}
