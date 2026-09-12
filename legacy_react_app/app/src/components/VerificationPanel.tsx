import { AccountLedger, TrialBalanceEntry } from '../types/accounting'

interface VerificationPanelProps {
  ledgers: AccountLedger[];
  trialBalance: TrialBalanceEntry[] | null;
  onImportBalance: () => void;
}

export default function VerificationPanel({ ledgers, trialBalance, onImportBalance }: VerificationPanelProps) {
  // アプリ側の科目別残高（親科目＝補助科目なしのみ）を取得
  const appBalances = new Map<string, number>()
  for (const l of ledgers) {
    if (!l.subAccountName) {
      appBalances.set(l.accountName, l.closingBalance)
    }
  }

  // やよい側の残高マップ
  const yayoiBalances = new Map<string, { balance: number; classification: string }>()
  if (trialBalance) {
    for (const tb of trialBalance) {
      yayoiBalances.set(tb.accountName, { balance: tb.annualBalance, classification: tb.classification })
    }
  }

  // 全科目リスト（両方のキーを合算、ただしやよいのみで残高0の科目は除外）
  const allAccounts = new Set<string>()
  appBalances.forEach((_, k) => allAccounts.add(k))
  yayoiBalances.forEach((v, k) => {
    // やよいにしかなく残高0の科目（使われていない勘定科目）は表示しない
    if (!appBalances.has(k) && v.balance === 0) return
    allAccounts.add(k)
  })
  const sortedAccounts = Array.from(allAccounts).sort()

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>🔍 検証パネル（やよいとの突き合わせ）</h2>

      {!trialBalance && (
        <div style={{
          textAlign: 'center', padding: '32px',
          backgroundColor: 'var(--bg-panel)', borderRadius: '12px',
          border: '1px dashed var(--border)', marginBottom: '24px'
        }}>
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
            やよいの「残高試算表」をインポートして、アプリの計算結果と比較します。
          </p>
          <button onClick={onImportBalance}>残高試算表をインポート</button>
        </div>
      )}

      {trialBalance && (
        <>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button onClick={onImportBalance} style={{ fontSize: '0.85rem' }}>
              再インポート
            </button>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {trialBalance.length} 科目を読み込み済み
            </span>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>分類</th>
                  <th>勘定科目</th>
                  <th style={{ textAlign: 'right' }}>アプリ残高</th>
                  <th style={{ textAlign: 'right' }}>やよい残高</th>
                  <th style={{ textAlign: 'right' }}>差異</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map(acc => {
                  const appBal = appBalances.get(acc) ?? null
                  const yayoiEntry = yayoiBalances.get(acc)
                  const yayoiBal = yayoiEntry?.balance ?? null
                  const classification = yayoiEntry?.classification || ''

                  // やよいは残高を絶対値で表示するため、比較時にも絶対値を使用
                  const appBalAbs = appBal !== null ? Math.abs(appBal) : null

                  // 両方にある場合のみ差異を計算
                  let diff: number | null = null
                  if (appBalAbs !== null && yayoiBal !== null) {
                    diff = appBalAbs - yayoiBal
                  }

                  const isMatch = diff !== null && diff === 0
                  const hasDiff = diff !== null && diff !== 0
                  const isAppOnly = appBal !== null && yayoiBal === null
                  const isYayoiOnly = appBal === null && yayoiBal !== null

                  return (
                    <tr
                      key={acc}
                      style={{
                        backgroundColor: hasDiff ? 'rgba(255, 80, 80, 0.1)' : isMatch ? 'rgba(80, 255, 120, 0.05)' : undefined
                      }}
                    >
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{classification}</td>
                      <td>{acc}</td>
                      <td className="amount">{appBalAbs !== null ? appBalAbs.toLocaleString() : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                      <td className="amount">{yayoiBal !== null ? yayoiBal.toLocaleString() : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                      <td className="amount" style={{ color: hasDiff ? 'var(--loss)' : 'var(--profit)' }}>
                        {diff !== null ? diff.toLocaleString() : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isMatch && <span style={{ color: 'var(--profit)' }}>✅ 一致</span>}
                        {hasDiff && <span style={{ color: 'var(--loss)' }}>❌ 不一致</span>}
                        {isAppOnly && <span style={{ color: '#ffaa00' }}>⚠️ やよいに無し</span>}
                        {isYayoiOnly && <span style={{ color: '#ffaa00' }}>⚠️ アプリに無し</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
