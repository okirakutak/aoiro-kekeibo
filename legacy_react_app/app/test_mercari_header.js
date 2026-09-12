const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('メルカリ');
  if(sheet) {
    const row = sheet.getRow(1);
    console.log(row.values);
  } else {
    console.log('Sheet not found');
  }
});
