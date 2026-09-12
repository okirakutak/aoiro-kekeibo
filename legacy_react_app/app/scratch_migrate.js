const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const configDir = path.join(__dirname, 'electron', 'plugins', 'configs');
const excelPath = path.join(__dirname, '../2025青色申告.xlsx');

async function migrate() {
  const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));
  const configs = files.map(f => {
    return JSON.parse(fs.readFileSync(path.join(configDir, f), 'utf-8'));
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const sheet = workbook.getWorksheet('設定');

  // 既存のシート名をキーに行番号を記録
  const rowMap = new Map();
  let lastRow = 3;
  sheet.eachRow((row, rowNum) => {
    if (rowNum > 3) {
      const sheetName = String(row.getCell(1).value || '').trim();
      if (sheetName) rowMap.set(sheetName, rowNum);
      lastRow = Math.max(lastRow, rowNum);
    }
  });

  for (const config of configs) {
    // ターゲットシート名があればそれ、なければプラグイン名
    const targetSheet = config.targetSheet || config.name;
    const jsonStr = JSON.stringify(config, null, 2);

    let rowNum = rowMap.get(targetSheet);
    if (rowNum) {
      // 既存行があればH列にセット
      sheet.getRow(rowNum).getCell(8).value = jsonStr;
      console.log(`Updated row ${rowNum} for ${targetSheet}`);
    } else {
      // なければ新規行を追加
      lastRow++;
      const row = sheet.getRow(lastRow);
      row.getCell(1).value = targetSheet; // シート名
      row.getCell(8).value = jsonStr;
      console.log(`Added row ${lastRow} for ${targetSheet}`);
    }
  }

  // バックアップを取ってから保存
  fs.copyFileSync(excelPath, excelPath + '.migrate.bak');
  await workbook.xlsx.writeFile(excelPath);
  console.log('Migration completed!');
}

migrate().catch(console.error);
