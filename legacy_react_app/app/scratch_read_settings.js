const ExcelJS = require('exceljs');
async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx');
  const sheet = wb.getWorksheet('設定');
  if (!sheet) {
    console.log('設定シートがありません。');
    return;
  }
  for (let i = 1; i <= 3; i++) {
    const row = sheet.getRow(i);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      vals.push(`${colNum}: ${cell.text}`);
    });
    console.log(`Row ${i}:`, vals.join(' | '));
  }
}
run().catch(console.error);
