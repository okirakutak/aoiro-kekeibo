import { useState, useEffect } from 'react'
import { AccountLedger } from '../types/accounting'

function getLedgerKey(account: string, sub?: string) {
  return sub ? `${account}::${sub}` : account
}

export default function LedgerTable({ ledgers }: { ledgers: AccountLedger[] }) {
  const [selectedKey, setSelectedKey] = useState<string>('')

  // ledgersが更新されたら初期選択をセット
  useEffect(() => {
    if (ledgers && ledgers.length > 0 && !selectedKey) {
      setSelectedKey(getLedgerKey(ledgers[0].accountName, ledgers[0].subAccountName))
    }
  }, [ledgers])

  if (!ledgers || ledgers.length === 0) return <p>元帳データがありません。</p>

  const activeLedger = ledgers.find(l => getLedgerKey(l.accountName, l.subAccountName) === selectedKey)

  const formatAccount = (account: string, sub?: string) => {
    return sub ? `${account} (${sub})` : account
  }

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>総勘定元帳</h2>
      
      <div style={{ marginBottom: '24px' }}>
        <select 
          value={selectedKey} 
          onChange={(e) => setSelectedKey(e.target.value)}
          style={{ 
            padding: '8px', 
            borderRadius: '4px', 
            backgroundColor: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            width: '400px'
          }}
        >
          {ledgers.map(l => {
            const key = getLedgerKey(l.accountName, l.subAccountName)
            const label = !l.subAccountName
              ? `📁 ${l.accountName} (すべて) - 残高: ${l.closingBalance.toLocaleString()}`
              : `　└ ${l.subAccountName} - 残高: ${l.closingBalance.toLocaleString()}`
            return (
              <option key={key} value={key}>
                {label}
              </option>
            )
          })}
        </select>
      </div>

      {activeLedger && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>相手勘定</th>
                <th>摘要</th>
                <th style={{ textAlign: 'right' }}>借方</th>
                <th style={{ textAlign: 'right' }}>貸方</th>
                <th style={{ textAlign: 'right' }}>残高</th>
              </tr>
            </thead>
            <tbody>
              {/* 前期繰越行（常に1行目として表示） */}
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td></td>
                <td></td>
                <td>前期繰越</td>
                <td className="amount"></td>
                <td className="amount"></td>
                <td className="amount">{activeLedger.openingBalance.toLocaleString()}</td>
              </tr>
              {activeLedger.entries.map((entry, idx) => (
                <tr key={idx}>
                  <td>{new Date(entry.date).toLocaleDateString()}</td>
                  <td>{formatAccount(entry.opponentAccount, entry.opponentSubAccount)}</td>
                  <td>{entry.description}</td>
                  <td className="amount">{entry.debitAmount ? entry.debitAmount.toLocaleString() : ''}</td>
                  <td className="amount">{entry.creditAmount ? entry.creditAmount.toLocaleString() : ''}</td>
                  <td className="amount">{entry.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td colSpan={3}>期末残高</td>
                <td className="amount">{activeLedger.totalDebit.toLocaleString()}</td>
                <td className="amount">{activeLedger.totalCredit.toLocaleString()}</td>
                <td className="amount">{activeLedger.closingBalance.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
