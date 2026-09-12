const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('設定');
  if(!sheet) return console.log('設定シートなし');
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3) {
      const name = row.getCell(1).text.trim();
      if (name === 'メルカリ') {
        console.log(`=== メルカリ (Row ${rowNumber}) ===`);
        row.eachCell((cell, colNumber) => {
          console.log(`Col ${colNumber}: ${cell.text.trim()}`);
        });
      }
    }
  });
}).catch(e => console.error(e));
