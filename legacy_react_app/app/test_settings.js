const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
  const filePath = path.join(__dirname, '../2025青色申告.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const settingsSheet = workbook.getWorksheet('設定');
  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3) {
      console.log(`Row ${rowNumber}: Sheet=${row.getCell(1).text}, Acc=${row.getCell(2).text}, Sub=${row.getCell(3).text}, SettleAcc=${row.getCell(4).text}, SettleSub=${row.getCell(5).text}, Keyword=${row.getCell(6).text}`);
    }
  });
}
main().catch(console.error);
