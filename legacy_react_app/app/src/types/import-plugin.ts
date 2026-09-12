import { JournalEntry } from './accounting'

// インポートプラグインの共通インターフェース
export interface ImportPlugin {
  id: string;                    // プラグイン識別子（例: 'amazon-csv'）
  name: string;                  // 表示名（例: 'Amazon 注文履歴'）
  description: string;           // 説明
  supportedExtensions: string[]; // 対応ファイル拡張子（例: ['csv', 'txt']）

  targetSheet: string;          // 転記先ワークシート名

  // デフォルトの仕訳設定
  defaultDebitAccount: string;   // デフォルト借方科目
  defaultCreditAccount: string;  // デフォルト貸方科目
  defaultCreditSubAccount?: string; // デフォルト貸方補助科目

  // ファイルをパースして取引明細を返す
  parse(filePath: string): Promise<ImportedTransaction[]>;

  // 取引明細を仕訳データに変換する
  toJournalEntries(
    transactions: ImportedTransaction[],
    mappingRules?: MappingRule[]
  ): JournalEntry[];
}

// パース結果の中間データ
export interface ImportedTransaction {
  date: Date;
  description: string;     // 摘要
  amount: number;           // 金額
  category?: string;        // カテゴリ（あれば）
  paymentMethod?: string;   // 支払方法（あれば）
  balance?: number;         // 残高（増分インポート判定用）
  rawData: Record<string, string>; // 元データの全カラム
}

// 科目マッピングルール
export interface MappingRule {
  keyword: string;           // 摘要に含まれるキーワード
  debitAccount: string;      // 一致時の借方科目
  debitSubAccount?: string;
  creditAccount?: string;    // 一致時の貸方科目
  creditSubAccount?: string;
}

// プラグイン情報（フロントエンドに渡すための軽量版）
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  supportedExtensions: string[];
  targetSheet: string;          // 転記先ワークシート名
  defaultDebitAccount: string;
  defaultCreditAccount: string;
  defaultCreditSubAccount?: string;
}
