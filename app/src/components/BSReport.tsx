export default function BSReport({ bs }: { bs: any }) {
  if (!bs) return <p>貸借データがありません。</p>

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>貸借対照表 (BS)</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* 資産 */}
        <div className="table-container">
          <h3 style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>資産（借方）</h3>
          <table>
            <tbody>
              {bs.assets.map((ast: any) => (
                <tr key={ast.accountName}>
                  <td>{ast.accountName}</td>
                  <td className="amount">{ast.closingBalance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td>合計</td>
                <td className="amount">{bs.totalAssets.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 負債・純資産 */}
        <div className="table-container">
          <h3 style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>負債・資本（貸方）</h3>
          <table>
            <tbody>
              {bs.liabilities.map((lib: any) => (
                <tr key={lib.accountName}>
                  <td>{lib.accountName}</td>
                  <td className="amount">{Math.abs(lib.closingBalance).toLocaleString()}</td>
                </tr>
              ))}
              {/* 当期利益の加算 */}
              <tr style={{ color: bs.netIncome >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                <td>当期純利益</td>
                <td className="amount">{bs.netIncome.toLocaleString()}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-panel)', fontWeight: 'bold' }}>
                <td>合計</td>
                <td className="amount">{(bs.totalLiabilities + bs.netIncome).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
