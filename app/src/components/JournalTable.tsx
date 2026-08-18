import { JournalEntry } from '../types/accounting'

export default function JournalTable({ entries }: { entries: JournalEntry[] }) {
  if (!entries || entries.length === 0) return <p>仕訳データがありません。</p>

  const formatAccount = (account: string, sub?: string) => {
    return sub ? `${account} (${sub})` : account
  }

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>仕訳帳 ({entries.length} 件)</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>借方</th>
              <th>貸方</th>
              <th style={{ textAlign: 'right' }}>金額</th>
              <th>摘要</th>
              <th>元データ</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => (
              <tr key={entry.id || idx}>
                <td>{new Date(entry.date).toLocaleDateString()}</td>
                <td>{formatAccount(entry.debitAccount, entry.debitSubAccount)}</td>
                <td>{formatAccount(entry.creditAccount, entry.creditSubAccount)}</td>
                <td className="amount">{entry.amount.toLocaleString()}</td>
                <td>{entry.description}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{entry.sourceSheet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
