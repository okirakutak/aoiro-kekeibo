// 設定シートを統一テーブル形式に移行するスクリプト
const ExcelJS = require('exceljs');

const SETTINGS_ROWS = [
  // 銀行口座（決済チェーンの終端）
  { sheet: '福岡銀行',     account: '普通預金', sub: '福岡銀行',     settleAcc: '', settleSub: '', keyword: '', balance: '' },
  { sheet: '郵貯銀行',     account: '普通預金', sub: '郵貯銀行',     settleAcc: '', settleSub: '', keyword: '', balance: '' },
  { sheet: '住信SBI銀行',  account: '普通預金', sub: '住信SBI銀行',  settleAcc: '', settleSub: '', keyword: '', balance: '' },
  { sheet: 'PayPay銀行',   account: '普通預金', sub: 'PayPay銀行',   settleAcc: '', settleSub: '', keyword: '', balance: '' },

  // クレジットカード（銀行から引き落とし）
  { sheet: 'Amazonカード', account: '未払金', sub: 'Amazonカード', settleAcc: '普通預金', settleSub: '住信SBI銀行', keyword: 'ミツイスミトモカード', balance: '' },

  // ショッピングサイト（カードで決済）
  { sheet: 'Amazon',     account: '未払金', sub: 'Amazon',     settleAcc: '未払金', settleSub: 'Amazonカード', keyword: 'ＡＭＡＺＯＮ',                       balance: '' },
  { sheet: 'AliExpress', account: '未払金', sub: 'AliExpress', settleAcc: '未払金', settleSub: 'Amazonカード', keyword: 'ALIEXPRESS',                          balance: '' },
  { sheet: 'ヤフオク',   account: '未払金', sub: 'ヤフオク',   settleAcc: '未払金', settleSub: 'Amazonカード', keyword: 'ヤフーかんたん決済,ヤフ−カンタンケッサイ', balance: '' },
  { sheet: 'メルカリ',   account: '未払金', sub: 'メルカリ',   settleAcc: '未払金', settleSub: 'Amazonカード', keyword: 'メルカリ',                              balance: '' },

  // 補助科目なしのBS科目（繰越残高のみ）
  { sheet: '',            account: '未払金', sub: '',           settleAcc: '', settleSub: '', keyword: '', balance: 16580 },
  { sheet: '',            account: '未払金', sub: '三井住友カード', settleAcc: '', settleSub: '', keyword: '', balance: 0 },
];

(async () => {
  const filePath = '/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // 既存の設定シートを削除して再作成
  let ws = wb.getWorksheet('設定');
  if (ws) wb.removeWorksheet(ws.id);
  ws = wb.addWorksheet('設定', { properties: { tabColor: { argb: 'FF70AD47' } } });

  // 対象年度（テーブルの上に配置）
  ws.getCell('A1').value = '対象年度';
  ws.getCell('B1').value = 2025;
  ws.getRow(1).font = { bold: true };

  // ヘッダ行（3行目から）
  const headers = ['シート名', '勘定科目', '補助科目名', '決済先科目', '決済先補助', '検索キーワード', '繰越残高'];
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };

  // 列幅の設定
  ws.columns = [
    { width: 16 }, // シート名
    { width: 12 }, // 勘定科目
    { width: 16 }, // 補助科目名
    { width: 12 }, // 決済先科目
    { width: 16 }, // 決済先補助
    { width: 30 }, // 検索キーワード
    { width: 12 }, // 繰越残高
  ];

  // データ行（4行目から）
  SETTINGS_ROWS.forEach((row, i) => {
    const r = ws.getRow(4 + i);
    r.getCell(1).value = row.sheet || '';
    r.getCell(2).value = row.account;
    r.getCell(3).value = row.sub || '';
    r.getCell(4).value = row.settleAcc || '';
    r.getCell(5).value = row.settleSub || '';
    r.getCell(6).value = row.keyword || '';
    r.getCell(7).value = row.balance !== '' ? row.balance : '';
  });

  await wb.xlsx.writeFile(filePath);
  console.log(`設定シートを統一テーブル形式に移行しました（${SETTINGS_ROWS.length}行）`);
})();
