const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx').then(() => {
  const sheet = wb.getWorksheet('メルカリ');
  if(!sheet) return console.log('シートなし');
  
  // 1行目から3行目までのD列（4列目）のセル情報を細かくチェック
  for(let r = 1; r <= 3; r++) {
    const row = sheet.getRow(r);
    const cell = row.getCell(4);
    console.log(`Row ${r} Col 4 Details:`);
    console.log(`  - value:`, cell.value);
    console.log(`  - type:`, cell.type); // Cell型 (Number, String, Formula等)
    console.log(`  - formula:`, cell.formula);
    console.log(`  - model:`, cell.model); // セルの内部モデル
    console.log(`  - master cell:`, cell.master.address); // セル結合時の親セルアドレス
  }
}).catch(e => console.error(e));
