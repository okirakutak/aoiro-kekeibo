export default function PLReport({ pl }: { pl: any }) {
  if (!pl) return <p>損益データがありません。</p>

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>損益計算書 (PL)</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* 費用 */}
        <div className="table-container">
          <h3 style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>費用（借方）</h3>
          <table>
            <tbody>
              {pl.expenses.map((exp: any) => (
                <tr key={exp.accountName}>
                  <td>{exp.accountName}</td>
                  <td className="amount">{Math.abs(exp.closingBalance).toLocaleString()}</td>
                </tr>
              ))}
              {/* 利益を埋める部分（費用の合計 + 利益 = 収益） */}
              {pl.netIncome > 0 && (
                <tr style={{ color: 'var(--profit)' }}>
                  <td>当期純利益</td>
                  <td className="amount">{pl.netIncome.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td>合計</td>
                <td className="amount">{(pl.totalExpense + (pl.netIncome > 0 ? pl.netIncome : 0)).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 収益 */}
        <div className="table-container">
          <h3 style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>収益（貸方）</h3>
          <table>
            <tbody>
              {pl.revenues.map((rev: any) => (
                <tr key={rev.accountName}>
                  <td>{rev.accountName}</td>
                  <td className="amount">{Math.abs(rev.closingBalance).toLocaleString()}</td>
                </tr>
              ))}
              {/* 損失を埋める部分 */}
              {pl.netIncome < 0 && (
                <tr style={{ color: 'var(--loss)' }}>
                  <td>当期純損失</td>
                  <td className="amount">{Math.abs(pl.netIncome).toLocaleString()}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td>合計</td>
                <td className="amount">{(pl.totalRevenue + (pl.netIncome < 0 ? Math.abs(pl.netIncome) : 0)).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
