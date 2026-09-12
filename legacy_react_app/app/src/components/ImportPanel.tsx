import { useState, useEffect } from 'react'

// 日付データを安全に描画するためのフォーマット関数
const formatDate = (dateVal: any): string => {
  if (!dateVal) return ''
  if (dateVal instanceof Date) {
    return dateVal.toLocaleDateString('ja-JP')
  }
  if (typeof dateVal === 'string') {
    const d = new Date(dateVal)
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('ja-JP')
    }
    return dateVal
  }
  return String(dateVal)
}

// 金額データを安全に描画するためのフォーマット関数
const formatAmount = (amountVal: any): string => {
  if (amountVal === undefined || amountVal === null) return '0'
  if (typeof amountVal === 'number') {
    return amountVal.toLocaleString()
  }
  const cleaned = String(amountVal).replace(/[,¥￥\s円]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? '0' : num.toLocaleString()
}

export default function ImportPanel() {
  const [targets, setTargets] = useState<any[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>('')
  const [importing, setImporting] = useState(false)

  // AIハイブリッドインポート用の状態
  const [fileFormat, setFileFormat] = useState<'html' | 'csv'>('html')
  const [importMode, setImportMode] = useState<'json' | 'direct'>('json')
  
  // none -> waiting_paste -> preview
  const [aiStep, setAiStep] = useState<'none' | 'waiting_paste' | 'preview'>('none')
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [aiInput, setAiInput] = useState('')
  const [previewData, setPreviewData] = useState<any[]>([])
  const [previewType, setPreviewType] = useState<'json' | 'tsv'>('json')

  // 初期ロード
  useEffect(() => {
    fetchTargets()
  }, [])
  
  const fetchTargets = async () => {
    // @ts-ignore
    const res = await window.electronAPI.getImportTargets()
    if (res && res.success) {
      setTargets(res.data)
      if (res.data.length > 0) {
        setSelectedSheet(res.data[0].sheetName)
      }
    }
  }

  // 選択切り替え時リセット
  useEffect(() => {
    setAiStep('none')
    setAiInput('')
    setPreviewData([])
    setFilePaths([])
  }, [selectedSheet])

  const target = targets.find(t => t.sheetName === selectedSheet)

  // ==========================================
  // パターン1: 既存JSONがある場合（ファイルを選択してプレビュー）
  // ==========================================
  const handleSelectFileAndPreview = async () => {
    setImporting(true)
    // ファイル選択（複数可）
    // @ts-ignore
    const targetFilePaths = await window.electronAPI.selectImportFiles()
    if (!targetFilePaths || targetFilePaths.length === 0) {
      setImporting(false)
      return
    }
    
    // JSON文字列とファイルパスの配列を渡してパース
    const jsonStr = JSON.stringify(target.jsonConfig)
    // @ts-ignore
    const res = await window.electronAPI.previewWithJson(jsonStr, targetFilePaths)
    
    if (res && res.success) {
      setPreviewData(res.data.entries || res.data.transactions) // JournalEntryのリストを想定
      setFilePaths(targetFilePaths)
      setPreviewType('json')
      setAiStep('preview')
    } else {
      alert(`❌ エラー\n\n${res?.error || 'ファイルの解析に失敗しました。'}`)
    }
    setImporting(false)
  }

  // ==========================================
  // パターン2: 既存JSONがない場合（テキスト抽出＆プロンプト生成）
  // ==========================================
  const handleExtractAndPrompt = async () => {
    setImporting(true)
    // @ts-ignore
    const res = await window.electronAPI.extractTextFromFiles(fileFormat)
    setImporting(false)
    
    if (!res || !res.success) {
      if (res?.error) alert(`エラー: ${res.error}`)
      return
    }
    
    setFilePaths(res.filePaths)
    
    // AI用プロンプト生成
    let prompt = ''
    if (importMode === 'json') {
      const typeDef = `
interface PluginConfig {
  id: string; // UUID等を指定
  name: string; // 表示名
  description: string;
  format: 'text' | 'csv' | 'html'; // テキストから正規表現で抽出する場合は'text'を指定
  encoding: string; // 'UTF-8' 等
  supportedExtensions: string[]; // ['.html', '.csv', '.txt'] 等
  targetSheet: string;
  defaultDebitAccount: string;
  defaultDebitSubAccount?: string;
  defaultCreditAccount: string;
  defaultCreditSubAccount?: string;
  // formatが'text'の場合に使用する正規表現ルール
  textPatterns?: {
    blockSeparator: string; // 各取引レコードを分割するための正規表現
    date: string; // 日付抽出用の正規表現 (キャプチャグループ1が日付になるように)
    description: string; // 摘要抽出用の正規表現
    amount: string; // 金額抽出用の正規表現
  };
}
`;
      prompt = `あなたは青色申告アプリの「インポート設定JSON」を作成するエキスパートAIです。
対象シート: ${target.sheetName}
デフォルト科目: ${target.account}${target.subAccount ? ` / ${target.subAccount}` : ''}

以下の「PluginConfig」の型定義に厳密に従ってJSONを生成してください。独自のプロパティ（extraction_rules等）は絶対に追加しないでください。
${typeDef}

【指示】
・出力はJSONブロック(\`\`\`json)のみとしてください。
・対象データはHTMLをプレーンテキストに変換したものです。formatは「text」を指定し、textPatternsを使用してデータを抽出する設定にしてください。
・textPatternsの正規表現では、必ず抽出したい値をキャプチャグループ()で囲んでください。
・targetSheetは必ず「${target.sheetName}」にしてください。
・デフォルトの借方・貸方の科目を適切に設定してください。（ただし、相手先の勘定科目と補助科目は未払金やクレジットカードとは限らないため、常に空欄「""」に設定してください）

【抽出データサンプル】
${res.data}`
    } else {
      prompt = `あなたは会計データの入力アシスタントです。
対象シート: ${target.sheetName}
対象シートの基準科目: ${target.account}${target.subAccount ? ` / ${target.subAccount}` : ''}

以下の抽出テキストから取引を抽出し、「日付(YYYY/MM/DD)」「勘定科目」「補助科目」「摘要」「金額(カンマなし数値)」「備考」の順でタブ区切り（TSV）で出力してください。ヘッダは不要です。
【重要】相手先の勘定科目と補助科目は未払金やクレジットカードとは限らないため、TSVの「勘定科目」「補助科目」列は常に空欄（タブ区切りで値なし）にして出力してください。

${res.data}`
    }
    
    try {
      // @ts-ignore
      const copyRes = await window.electronAPI.writeToClipboard(prompt)
      if (copyRes && copyRes.success) {
        alert('AIへの指示用プロンプトをクリップボードにコピーしました！\n\nお使いのAI（ChatGPT等）に貼り付け、出力された結果をこの後のテキストボックスに貼り付けてください。')
        setAiStep('waiting_paste')
      } else {
        alert(`クリップボードへのコピーに失敗しました。\n${copyRes?.error}`)
      }
    } catch (err) {
      alert('クリップボードへのコピー時にエラーが発生しました。')
    }
  }

  // ==========================================
  // ペースト後のプレビュー生成
  // ==========================================
  const handleAiInputNext = async () => {
    if (!aiInput.trim()) return
    setImporting(true)

    try {
      if (importMode === 'json') {
        // AIが生成したJSONをパースしてプレビュー
        let jsonStr = aiInput.trim()
        if (jsonStr.startsWith('\`\`\`json')) {
          jsonStr = jsonStr.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
        }
        
        // JSON形式チェック
        JSON.parse(jsonStr)
        
        // @ts-ignore
        const res = await window.electronAPI.previewWithJson(jsonStr, filePaths)
        if (res && res.success) {
          setPreviewData(res.data.entries || res.data.transactions)
          setPreviewType('json')
          // まだ保存せず、プレビュー画面に遷移するだけ
          // 保存時に、設定シートへのJSON保存とデータ書き込みを同時に行う
          setAiInput(jsonStr)
          setAiStep('preview')
        } else {
          alert(`JSONを使ったパースに失敗しました:\n${res?.error}`)
        }
      } else {
        // TSV直接パース
        const lines = aiInput.trim().split('\n')
        const parsed = lines.map(line => {
          const cols = line.split('\t')
          return {
            date: cols[0]?.trim(),
            debitAccount: '',
            debitSubAccount: '',
            creditAccount: cols[1]?.trim() || '',
            creditSubAccount: cols[2]?.trim() || '',
            description: cols[3]?.trim(),
            amount: parseInt((cols[4] || '0').replace(/[,¥\s]/g, ''), 10) || 0,
            memo: cols[5]?.trim()
          }
        })
        setPreviewData(parsed)
        setPreviewType('tsv')
        setAiStep('preview')
      }
    } catch (e: any) {
      alert(`データの解析に失敗しました。フォーマットを確認してください。\n${e.message}`)
    }
    
    setImporting(false)
  }

  // ==========================================
  // プレビュー後の保存実行
  // ==========================================
  const handleSave = async () => {
    setImporting(true)
    try {
      if (previewType === 'json') {
        // JSON生成モードの場合は、設定シートにもJSONを保存する
        if (aiInput) {
          // @ts-ignore
          await window.electronAPI.savePluginConfig(target.sheetName, aiInput)
        }
        
        // Excelに書き込み
        // @ts-ignore
        const res = await window.electronAPI.writeToExcel('/dummy', target.sheetName, previewData)
        if (res && res.success) {
          alert(`✅ 保存完了\n${res.data.count}件のデータを「${target.sheetName}」シートに転記しました。`)
          fetchTargets() // リスト更新
          setAiStep('none')
        } else {
          alert(`❌ エラー\n${res?.error}`)
        }
      } else {
        // TSVモードの場合、データ書き込みのみ
        // TSVデータは writeToExcel の transactions 形式 (JournalEntry) にある程度寄せているが、
        // writeToExcel 内部で適宜変換されることを想定
        // @ts-ignore
        const res = await window.electronAPI.writeToExcel('/dummy', target.sheetName, previewData)
        if (res && res.success) {
          alert(`✅ 保存完了\n${res.data.count}件のデータを「${target.sheetName}」シートに転記しました。`)
          setAiStep('none')
        } else {
          alert(`❌ エラー\n${res?.error}`)
        }
      }
    } catch (err: any) {
      alert(`❌ エラーが発生しました\n${err.message}`)
    }
    setImporting(false)
  }

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>📥 データインポート</h2>

      {targets.length === 0 ? (
        <div style={{
          backgroundColor: 'var(--bg-panel)', borderRadius: '12px', padding: '48px',
          border: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-secondary)'
        }}>
          <p>対象となるワークシートがありません。</p>
        </div>
      ) : (
        <div style={{
          backgroundColor: 'var(--bg-panel)', borderRadius: '12px', padding: '24px',
          border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '24px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>
            {/* 左側: ワークシート名リストボックス */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                ワークシート
              </div>
              <div style={{
                border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-base)',
                height: '400px', overflowY: 'auto'
              }}>
                {targets.map(t => (
                  <div
                    key={t.sheetName}
                    onClick={() => setSelectedSheet(t.sheetName)}
                    style={{
                      padding: '12px 16px', cursor: 'pointer',
                      backgroundColor: selectedSheet === t.sheetName ? 'var(--bg-hover)' : 'transparent',
                      color: selectedSheet === t.sheetName ? 'var(--accent)' : 'var(--text-primary)',
                      fontWeight: selectedSheet === t.sheetName ? 'bold' : 'normal',
                      borderLeft: selectedSheet === t.sheetName ? '4px solid var(--accent)' : '4px solid transparent',
                      borderBottom: '1px solid var(--border)', transition: 'all 0.15s ease',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}
                  >
                    <span>{t.sheetName}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                      {t.hasJson ? '⚙️ 自動' : '🤖 AI'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 右側: 処理エリア */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              {/* ステップ: プレビュー画面 */}
              {aiStep === 'preview' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                  <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    インポートデータのプレビュー ({previewData.length}件)
                  </div>
                  <div style={{
                    border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-base)',
                    flex: 1, overflowY: 'auto', padding: '16px'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                          <th style={{ padding: '8px' }}>日付</th>
                          <th style={{ padding: '8px' }}>摘要</th>
                          <th style={{ padding: '8px' }}>勘定科目</th>
                          <th style={{ padding: '8px' }}>金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((d, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px' }}>{formatDate(d.date || d.rawData?.date)}</td>
                            <td style={{ padding: '8px' }}>{d.description || d.rawData?.description || ''}</td>
                            <td style={{ padding: '8px' }}>{d.creditAccount || d.debitAccount || ''}</td>
                            <td style={{ padding: '8px' }}>{formatAmount(d.amount !== undefined ? d.amount : d.rawData?.amount)}円</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setAiStep('none')} style={{ padding: '10px 24px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>キャンセル</button>
                    <button onClick={handleSave} disabled={importing} style={{ padding: '10px 32px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
                      {importing ? '保存中...' : 'データを保存'}
                    </button>
                  </div>
                </div>
              ) : 
              
              /* ステップ: テキスト（プロンプト結果）入力待ち */
              aiStep === 'waiting_paste' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                  <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    AIの出力結果を貼り付けてください
                  </div>
                  <textarea 
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    placeholder={importMode === 'json' ? "```json\n{\n  ...\n}\n```" : "2024/01/01\t通信費\t\tインターネット代\t5000\n..."}
                    style={{
                      flex: 1, padding: '16px', borderRadius: '8px', border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'monospace',
                      resize: 'none', minHeight: '300px'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setAiStep('none')} style={{ padding: '10px 24px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>キャンセル</button>
                    <button onClick={handleAiInputNext} disabled={importing || !aiInput} style={{ padding: '10px 32px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
                      {importing ? '処理中...' : '次へ (プレビュー)'}
                    </button>
                  </div>
                </div>
              ) : 
              
              /* ステップ: 初期設定画面 */
              target ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                  <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    インポート設定
                  </div>
                  
                  <div style={{
                    border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-base)',
                    padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px'
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                      {target.sheetName}
                    </div>

                    {target.hasJson ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ color: 'var(--success)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.2rem' }}>✓</span> インポート設定(JSON) 登録済み
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                          対象形式: <b>{target.jsonConfig?.format?.toUpperCase() || 'CSV'}</b><br/>
                          デフォルト勘定科目: {target.jsonConfig?.defaultDebitAccount || target.account}<br/>
                          文字コード: {target.jsonConfig?.encoding || 'UTF-8'}
                        </div>
                        <button
                          onClick={handleSelectFileAndPreview}
                          disabled={importing}
                          style={{
                            marginTop: '16px', padding: '12px 32px', backgroundColor: 'var(--accent)', color: '#fff',
                            border: 'none', borderRadius: '8px', cursor: importing ? 'wait' : 'pointer',
                            fontSize: '1.1rem', fontWeight: 'bold', alignSelf: 'flex-start'
                          }}
                        >
                          {importing ? '処理中...' : 'ファイルを選択してインポート (複数可)'}
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ color: 'var(--warning)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.2rem' }}>⚠️</span> インポート設定(JSON) 未登録
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                          設定がないため、AIを活用して自動化します。対象ファイルの形式と処理モードを選択してください。
                        </div>
                        
                        <div style={{ display: 'flex', gap: '24px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>ファイル形式</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input type="radio" name="format" checked={fileFormat === 'html'} onChange={() => setFileFormat('html')} />
                              HTMLファイル (複数可)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input type="radio" name="format" checked={fileFormat === 'csv'} onChange={() => setFileFormat('csv')} />
                              CSV / TSV (単一)
                            </label>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>処理モード</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input type="radio" name="mode" checked={importMode === 'json'} onChange={() => setImportMode('json')} />
                              インポート用JSONを生成 (永続化)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input type="radio" name="mode" checked={importMode === 'direct'} onChange={() => setImportMode('direct')} />
                              インポートデータを直接生成 (今回のみ)
                            </label>
                          </div>
                        </div>

                        <button
                          onClick={handleExtractAndPrompt}
                          disabled={importing}
                          style={{
                            marginTop: '16px', padding: '12px 32px', backgroundColor: 'var(--accent)', color: '#fff',
                            border: 'none', borderRadius: '8px', cursor: importing ? 'wait' : 'pointer',
                            fontSize: '1.1rem', fontWeight: 'bold', alignSelf: 'flex-start'
                          }}
                        >
                          {importing ? '抽出中...' : 'ファイルを選択してテキスト抽出'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
