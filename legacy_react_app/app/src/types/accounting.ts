export interface JournalEntry {
  id: string;
  date: Date;
  debitAccount: string;
  debitSubAccount?: string; // 借方・補助科目
  creditAccount: string;
  creditSubAccount?: string; // 貸方・補助科目
  amount: number;
  description: string;
  note?: string;
  sourceSheet: string;
}

export interface Account {
  id: number;
  name: string;
  type: '資産' | '負債' | '資本' | '収益' | '費用';
}

export interface LedgerEntry {
  date: Date;
  opponentAccount: string;
  opponentSubAccount?: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  balance: number;
}

export interface AccountLedger {
  accountName: string;
  subAccountName?: string; // 未設定の場合は大元（親）の合算
  entries: LedgerEntry[];
  openingBalance: number; // 前期繰越額（設定タブから取得、未設定の場合は0）
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

// やよいの残高試算表から読み込んだ科目ごとの期末残高
export interface TrialBalanceEntry {
  classification: string; // 「貸借対照表」or「損益計算書」
  accountName: string;    // 勘定科目名
  annualBalance: number;  // 当期残高（合計）
}
