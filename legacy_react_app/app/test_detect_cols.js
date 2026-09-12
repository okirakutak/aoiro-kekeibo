const ExcelJS = require('exceljs');
function detect(sheet) {
  const cols = { dateCol: 1, descCol: 3, amountCol: 4 }
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell, colNum) => {
    const text = String(cell.value || '').trim()
    console.log(`Col ${colNum}: '${text}'`)
    if (text === '日付') cols.dateCol = colNum
    if (text === '勘定科目') cols.accountCol = colNum
    if (text === '補助科目') cols.subAccountCol = colNum
    if (text === '摘要' || text === '項目名') cols.descCol = colNum
    if (text === '金額' || text === 'お支払金額' || text === '支払金額') cols.amountCol = colNum
    if (text === '入金' || text === '入金額' || text === 'お預り金額' || text === '収入') cols.incomeCol = colNum
    if (text === '支払' || text === '出金額' || text === '出金' || text === '支出' || text === '払出金額') cols.expenseCol = colNum
    if (text === '残高') cols.balanceCol = colNum
    if (text === '備考') cols.memoCol = colNum
  })
  if (!cols.accountCol) cols.accountCol = 2
  return cols
}

const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('メルカリ');
  console.log("=== detectSheetColumns result ===");
  console.log(detect(sheet));
});
