/**
 * JSON設定ファイルの型定義
 * プラグインフォルダに配置するJSONファイルのスキーマを定義する
 */

// CSV列の指定方法（単一列 or 複数列結合）
export type ColumnSpec =
  | { index: number }                          // 単一列
  | { index: number[]; join: string; format?: string } // 複数列を結合

// CSVフォーマットの列設定
export interface CsvColumnsConfig {
  date: ColumnSpec;             // 日付列
  description: ColumnSpec;      // 摘要列
  income?: ColumnSpec;          // 入金列（任意）
  expense?: ColumnSpec;         // 出金列（任意）
  amount?: ColumnSpec;          // 金額列（income/expenseが分かれていない場合）
  category?: ColumnSpec;        // カテゴリ・支払方法など（任意）
  balance?: ColumnSpec;         // 残高列（任意）
}

// HTMLフォーマットのCSSセレクタ設定
export interface HtmlSelectorsConfig {
  row: string;                  // 行のセレクタ（各取引のルート要素）
  description: string;          // 摘要のセレクタ（row内での相対）
  amount: string;               // 金額のセレクタ（row内での相対）
  dateText?: string;            // 日付テキストのセレクタ（row内での相対）
  dateAttr?: string;            // 日付を含む属性名（任意）
  orderId?: string;             // 注文番号のセレクタ（row内での相対、マージ用）
}

// 複数HTMLを結合するための追加設定
export interface HtmlMergeConfig {
  detailSelectors: HtmlSelectorsConfig; // 詳細ページ側のセレクタ
  matchKey: 'orderId' | 'date';         // 結合キー
}

// 科目マッピングルール
export interface ConfigMappingRule {
  keyword: string;              // 摘要に含まれるキーワード
  debitAccount: string;         // 一致時の借方科目
  debitSubAccount?: string;
  creditAccount?: string;       // 一致時の貸方科目（省略時はデフォルト）
  creditSubAccount?: string;
}

// JSON設定ファイルの全体構造
export interface PluginConfig {
  id: string;                   // プラグイン識別子
  name: string;                 // 表示名
  description: string;          // 説明
  format: 'csv' | 'html' | 'text'; // データ形式
  encoding: string;             // 文字エンコーディング（UTF-8, Shift_JIS, EUC-JP等）
  supportedExtensions: string[];// 対応拡張子
  multiFile?: boolean;          // 複数ファイル選択を許可するか

  // CSVフォーマット用設定
  delimiter?: string;           // 区切り文字（デフォルト: ','）
  skipRows?: number;            // 先頭からスキップする行数
  hasHeader?: boolean;          // ヘッダ行があるか
  requireBalance?: boolean;     // 残高列が空欄の行をスキップするか
  columns?: CsvColumnsConfig;   // 列の設定
  filterYear?: number;            // 指定年のデータのみインポート（全期間CSVのフィルタ用）

  // HTMLフォーマット用設定
  selectors?: HtmlSelectorsConfig; // CSSセレクタ設定（一覧ページ用、または単体用）
  htmlMerge?: HtmlMergeConfig;     // 詳細ページと結合する場合の設定
  datePattern?: string;         // 日付抽出用の正規表現パターン
  amountPattern?: string;       // 金額抽出用の正規表現パターン

  // 転記先のExcelワークシート名
  targetSheet: string;

  // Excelシートのレイアウト種別
  // 'bank': 日付, 勘定科目, 摘要, 入金, 支払, 残高, 備考（デフォルト）
  // 'credit-card': 日付, 勘定科目, 摘要, 金額, 支払日, 備考
  sheetLayout?: 'bank' | 'credit-card';

  // 前期繰越行の有無（true: 2行目に前期繰越、3行目からデータ / false: 2行目からデータ）
  // 省略時のデフォルト: bankはtrue、credit-cardはfalse
  hasOpeningBalance?: boolean;

  // クレジットカードの締め日・支払日設定
  cutoffDay?: number | 'last';           // 締め日（例: 15, 'last'）
  paymentMonthOffset?: number;          // 支払月オフセット（1: 翌月, 2: 翌々月）
  paymentDay?: number | 'last';          // 支払日（例: 10, 27, 'last'）

  // デフォルトの仕訳科目
  defaultDebitAccount: string;
  defaultDebitSubAccount?: string;
  defaultCreditAccount: string;
  defaultCreditSubAccount?: string;

  // 科目マッピングルール
  mappingRules?: ConfigMappingRule[];

  // テキスト形式用の抽出パターン
  textPatterns?: {
    blockSeparator: string;      // 各レコード（注文ブロック）を分割するための区切りパターン（正規表現）
    date: string;                // 日付抽出用の正規表現
    description: string;         // 摘要（商品名）抽出用の正規表現
    amount: string;              // 金額抽出用の正規表現
    orderId?: string;            // 注文番号抽出用の正規表現（任意）
  };

  // プラグイン・シートの区分
  // 'credit-card': クレジットカード
  // 'shopping': ショッピングサイトの注文履歴
  // 'bank': 銀行
  // 'sales': 売上/売掛管理
  type?: 'credit-card' | 'shopping' | 'bank' | 'sales';
}

