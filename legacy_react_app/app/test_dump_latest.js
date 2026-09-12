const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('メルカリ');
  if (!sheet) {
    console.log('メルカリシートが見つかりません');
    return;
  }
  console.log("=== Row Count ===", sheet.rowCount);
  console.log("=== Headers ===");
  console.log(sheet.getRow(1).values);
  
  console.log("=== All Data Rows ===");
  sheet.eachRow((row, rowNum) => {
    if (rowNum >= 1) {
      console.log(`Row ${rowNum}:`, row.values);
    }
  });
}).catch(e => console.error(e));
