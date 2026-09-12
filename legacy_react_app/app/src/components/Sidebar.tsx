interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const tabs = [
    { id: 'journal', label: '📖 仕訳帳' },
    { id: 'ledger', label: '📒 総勘定元帳' },
    { id: 'pl', label: '📊 損益計算書 (PL)' },
    { id: 'bs', label: '⚖️ 貸借対照表 (BS)' },
    { id: 'import', label: '📥 データインポート' },
    { id: 'bulk-setup', label: '🏷️ 科目一括設定' },
    { id: 'reconcile', label: '🔍 期末残高チェック' },
    { id: 'verify', label: '🔍 検証（やよい比較）' },
  ];

  return (
    <nav style={{ width: '220px', backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ padding: '24px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ color: 'var(--accent)', margin: 0 }}>青色申告 MVP</h2>
      </div>
      <ul style={{ listStyle: 'none', padding: '16px 0', flex: 1 }}>
        {tabs.map(tab => (
          <li key={tab.id}>
            <button
              onClick={() => onTabChange(tab.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '16px 24px',
                backgroundColor: activeTab === tab.id ? 'var(--bg-hover)' : 'transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 0,
                borderLeft: `4px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
                fontSize: '1rem',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
