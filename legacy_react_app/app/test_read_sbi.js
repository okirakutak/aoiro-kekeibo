const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
  const filePath = path.join(__dirname, '../2025青色申告.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetName = '住信SBI銀行';
  const sheet = workbook.getWorksheet(sheetName);
  
  if (!sheet) {
    console.log(`Sheet "${sheetName}" not found.`);
    return;
  }

  const headerRow = sheet.getRow(1).values;
  console.log('Headers:', headerRow);

  const targetYmd1 = '2025-05-26';
  const targetAmt1 = 62093;
  const normDescTarget1 = '口座振替ミツイスミトモカード';

  let found5 = false;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const dateVal = row.getCell(1).value;
    if (!dateVal) return;

    let ymd = '';
    if (typeof dateVal === 'string' && dateVal.includes('T')) {
      ymd = dateVal.split('T')[0];
    } else if (dateVal instanceof Date) {
      ymd = dateVal.toISOString().split('T')[0];
    } else if (typeof dateVal === 'number') {
      const msPerDay = 24 * 60 * 60 * 1000;
      const epoch = new Date(1899, 11, 30).getTime();
      ymd = new Date(epoch + dateVal * msPerDay).toISOString().split('T')[0];
    }

    const desc = String(row.getCell(4).value || '').trim();
    const inc = Number(row.getCell(5).value) || 0;
    const exp = Number(row.getCell(6).value) || 0;
    const amt = inc > 0 ? inc : exp;

    const normDesc1 = desc.replace(/\s+/g, '');

    if (ymd === targetYmd1 && amt === targetAmt1) {
      console.log(`[CANDIDATE 5/26] Row=${rowNumber}, YMD=${ymd}, AMT=${amt}, DESC=${desc}, normDesc=${normDesc1}, matchDesc=${normDesc1 === normDescTarget1}`);
      found5 = true;
    }
  });

  if (!found5) console.log('5/26 62093円 の取引は見つかりませんでした。');
}
main().catch(console.error);
