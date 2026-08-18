const ExcelJS = require('exceljs');

// ImportPanel.tsx でのパース処理をシミュレート
const rawData = `2025/11/16			Motorola moto g53 5G 本体	14800	
2025/10/06			DVI HDMI変換ケーブル双方向 1.5M 4 Kハイビジョン音声映像同期	650	
2025/09/23			ASUS GeForce RTX 3060 OC 12GB	24000	クーポン利用：250
2025/08/06			Pythonで動かして学ぶ！ あたらしい数学の教科書	1200	
2025/04/16			アイリスオーヤマ スティッククリーナー アタッチメントセットMTS29 おまけ付	3000	ポイント利用：35
2025/03/06			た*く様 Xiaomi Redmi Note 10 Pro ジャンク品 動作不安	7000`;

const lines = rawData.trim().split('\n');
const parsed = lines.map(line => {
  const cols = line.split('\t');
  return {
    date: cols[0]?.trim(),
    debitAccount: '',
    debitSubAccount: '',
    creditAccount: cols[1]?.trim() || '',
    creditSubAccount: cols[2]?.trim() || '',
    description: cols[3]?.trim(),
    amount: parseInt((cols[4] || '0').replace(/[,¥\s]/g, ''), 10) || 0,
    memo: cols[5]?.trim()
  }
});
console.log("=== Parsed Data (Front-end) ===");
console.log(parsed[0]);

// メインプロセスの変換処理をシミュレート
const restored = parsed.map(tx => ({
  ...tx,
  date: new Date(tx.date)
}));

// detectSheetColumns
function detectSheetColumns(sheet) {
  const cols = { dateCol: 1, descCol: 3, amountCol: 4 };
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim();
    if (text === '日付') cols.dateCol = colNum;
    if (text === '勘定科目') cols.accountCol = colNum;
    if (text === '補助科目') cols.subAccountCol = colNum;
    if (text === '摘要' || text === '項目名') cols.descCol = colNum;
    if (text === '金額' || text === 'お支払金額' || text === '支払金額') cols.amountCol = colNum;
    if (text === '入金' || text === '入金額' || text === 'お預り金額' || text === '収入') cols.incomeCol = colNum;
    if (text === '支払' || text === '出金額' || text === '出金' || text === '支出' || text === '払出金額') cols.expenseCol = colNum;
    if (text === '残高') cols.balanceCol = colNum;
    if (text === '備考') cols.memoCol = colNum;
  });
  if (!cols.accountCol) cols.accountCol = 2;
  return cols;
}

// excel-writer.service.ts の writeTransactionsToSheet をシミュレート
async function writeTest() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx');
  const sheet = wb.getWorksheet('メルカリ');
  
  const colsA = detectSheetColumns(sheet);
  console.log("=== Cols ===", colsA);

  const startRow = Math.max(2, sheet.rowCount + 1);
  console.log("=== Writing to row", startRow, "===");
  
  const tx = restored[0];
  const row = sheet.getRow(startRow);
  row.getCell(colsA.dateCol).value = tx.date;
  
  const txAny = tx;
  const account = txAny.creditAccount || txAny.debitAccount || '';
  const subAccount = txAny.creditSubAccount || txAny.debitSubAccount || '';
  
  if (colsA.accountCol) row.getCell(colsA.accountCol).value = account;
  if (colsA.subAccountCol) row.getCell(colsA.subAccountCol).value = subAccount;
  
  row.getCell(colsA.descCol).value = tx.description || '';
  if (colsA.memoCol && txAny.memo) row.getCell(colsA.memoCol).value = txAny.memo;
  row.getCell(colsA.amountCol || 4).value = tx.amount;
  
  row.commit();
  console.log("=== Written Row Values ===");
  console.log(row.values);
}

writeTest().catch(console.error);
