const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
  const filePath = path.join(__dirname, '../2025青色申告.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // 1. 設定シートの読み込み
  const settingsSheet = workbook.getWorksheet('設定');
  const configs = [];
  settingsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3) {
      const sheetName = row.getCell(1).text.trim();
      const account = row.getCell(2).text.trim();
      const subAccount = row.getCell(3).text.trim();
      const settleAcc = row.getCell(4).text.trim();
      const settleSub = row.getCell(5).text.trim();
      const keyword = row.getCell(6).text.trim();

      if (sheetName || subAccount) {
        configs.push({
          rowNumber,
          sheetName,
          account,
          subAccount,
          settleAcc,
          settleSub,
          keyword
        });
      }
    }
  });

  console.log('--- 設定シートのパース結果 ---');
  console.log(JSON.stringify(configs, null, 2));

  // 2. 住信SBI銀行シートの読み込み
  const sbiSheet = workbook.getWorksheet('住信SBI銀行');
  if (!sbiSheet) {
    console.log('住信SBI銀行シートが見つかりません');
    return;
  }

  const sbiEntries = [];
  sbiSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3) { // ヘッダー以降
      const dateVal = row.getCell(1).value;
      const date = dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal || '').trim();
      const debitAcc = row.getCell(2).text.trim();
      const debitSub = row.getCell(3).text.trim();
      const desc = row.getCell(4).text.trim();
      const inc = parseFloat(row.getCell(5).value) || 0;
      const exp = parseFloat(row.getCell(6).value) || 0;
      const note = row.getCell(8).text.trim();

      sbiEntries.push({
        rowNumber,
        date,
        debitAcc,
        debitSub,
        desc,
        amount: exp > 0 ? exp : inc,
        note
      });
    }
  });

  console.log(`\n--- 住信SBI銀行の全明細数: ${sbiEntries.length} 件 ---`);

  // 3. Amazonカードの条件で抽出テスト
  const selectedSubAccount = 'Amazonカード';
  const selectedLedgerKey = '未払金::Amazonカード';

  const currentConfig = configs.find(c => 
    (selectedSubAccount && c.subAccount === selectedSubAccount) ||
    (selectedSubAccount && c.sheetName === selectedSubAccount) ||
    c.sheetName === selectedLedgerKey
  );

  console.log('\n--- 取得された currentConfig ---');
  console.log(currentConfig);

  const rawKeyword = (currentConfig?.keyword || currentConfig?.settleSub || '').trim();
  console.log(`\n抽出キーワード: "${rawKeyword}"`);

  const normKeyword = rawKeyword.replace(/\s+/g, '');

  console.log('\n--- フィルタリング結果の詳細 ---');
  const matched = [];
  for (const e of sbiEntries) {
    const isAlreadySet = (e.debitAcc === '未払金' || e.creditAccount === '未払金') &&
                         (e.debitSub === selectedSubAccount || e.creditSubAccount === selectedSubAccount);
    const normDesc = (e.desc || '').replace(/\s+/g, '');
    const hasKeyword = normDesc.includes(normKeyword);

    if (e.desc.includes('ミツイスミトモ') || e.desc.includes('カード') || hasKeyword) {
      console.log(`Row ${e.rowNumber} [${e.date}]: desc="${e.desc}", debitAcc="${e.debitAcc}", debitSub="${e.debitSub}" | hasKeyword=${hasKeyword}, isAlreadySet=${isAlreadySet}`);
    }

    if (!isAlreadySet && hasKeyword) {
      matched.push(e);
    }
  }

  console.log(`\n--- 抽出成功件数: ${matched.length} 件 ---`);
  matched.forEach(m => {
    console.log(` -> Row ${m.rowNumber}: ${m.date} | ${m.desc} | ¥${m.amount}`);
  });
}

main().catch(console.error);
