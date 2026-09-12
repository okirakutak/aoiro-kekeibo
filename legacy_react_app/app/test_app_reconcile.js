const path = require('path');

// Electronでコンパイルされた main.js 内から loadJournalEntries 等を取得
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');

async function testAppLogic() {
  const filePath = path.join(__dirname, '../2025青色申告.xlsx');
  
  // アプリと同じ関数で仕訳を読み込む
  const entries = await loadJournalEntries(filePath);
  console.log(`全仕訳件数: ${entries.length} 件`);

  // ReconciliationPanel内での条件を完全に再現
  const selectedLedgerKey = '未払金::Amazonカード';
  const selectedSubAccount = 'Amazonカード';
  const selectedSettleSheet = '住信SBI銀行';

  // 1. configs 模倣 (対象シート Amazonカード の設定)
  const currentConfig = {
    sheetName: 'Amazonカード',
    account: '未払金',
    subAccount: 'Amazonカード',
    settleAcc: '住信SBI銀行',
    settleSub: '口座振替　ミツイスミトモカード',
    keyword: ''
  };

  // 2. ReconciliationPanel 544行目のロジック
  const rawKeyword = (currentConfig?.keyword || currentConfig?.settleSub || '').trim();
  console.log(`rawKeyword: "${rawKeyword}"`);
  const normKeyword = rawKeyword.replace(/\s+/g, '');

  // 3. rawSettleEntries の抽出 (selectedSettleSheet = 住信SBI銀行)
  const rawSettleEntries = entries.filter(e => e.sourceSheet === selectedSettleSheet);
  console.log(`住信SBI銀行の明細数 (sourceSheet === '住信SBI銀行'): ${rawSettleEntries.length} 件`);

  if (rawSettleEntries.length === 0) {
    console.log('❌ sourceSheet === "住信SBI銀行" の明細が0件です！sourceSheet の値を確認します:');
    const sampleSheets = Array.from(new Set(entries.map(e => e.sourceSheet)));
    console.log('全 sourceSheet の一覧:', sampleSheets);
    return;
  }

  // 4. selectedRightItems のフィルタリング
  const selectedRightItems = rawSettleEntries.filter(e => {
    const isAlreadySet = (e.debitAccount === '未払金' || e.creditAccount === '未払金') &&
                         (e.debitSubAccount?.trim() === selectedSubAccount || e.creditSubAccount?.trim() === selectedSubAccount);
    const normDesc = (e.description || '').replace(/\s+/g, '');
    const hasKeyword = normDesc.includes(normKeyword);

    if (hasKeyword) {
      console.log(`[候補発見] Date=${e.date?.toISOString().split('T')[0]}, desc="${e.description}", debitAcc="${e.debitAccount}", debitSub="${e.debitSubAccount}" => isAlreadySet=${isAlreadySet}`);
    }

    return !isAlreadySet && hasKeyword;
  });

  console.log(`\n抽出件数: ${selectedRightItems.length} 件`);
  selectedRightItems.forEach(item => {
    console.log(` -> Date: ${item.date?.toISOString().split('T')[0]} | Desc: ${item.description} | Amt: ¥${item.amount}`);
  });
}

testAppLogic().catch(console.error);
