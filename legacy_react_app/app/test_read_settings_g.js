const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('設定');
  if(!sheet) return console.log('設定シートなし');
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3) {
      const name = row.getCell(1).text.trim();
      const jsonText = row.getCell(7).text.trim();
      if (name === 'メルカリ' && jsonText) {
        console.log("=== メルカリ JSON ===");
        console.log(jsonText);
      }
    }
  });
}).catch(e => console.error(e));
