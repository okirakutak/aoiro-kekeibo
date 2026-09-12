const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('メルカリ');
  if(sheet) {
    console.log("=== Header ===");
    console.log(sheet.getRow(1).values);
    console.log("=== Last 5 rows ===");
    const rowCount = sheet.rowCount;
    const start = Math.max(2, rowCount - 4);
    for(let i = start; i <= rowCount; i++) {
      const r = sheet.getRow(i);
      if(r.values && r.values.length > 0) {
        console.log(`Row ${i}:`, r.values);
      }
    }
  } else {
    console.log('Sheet not found');
  }
}).catch(e => console.error(e));
