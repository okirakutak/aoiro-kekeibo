const { parseFiles } = require('./electron/services/config-parser-engine');
const { writeTransactionsToSheet } = require('./electron/services/excel-writer.service');
const fs = require('fs');
const path = require('path');

const config = {
  id: 'amazon-card',
  name: 'Amazonカード',
  format: 'csv',
  encoding: 'Shift_JIS',
  delimiter: ',',
  skipRows: 1,
  hasHeader: false,
  supportedExtensions: ['csv'],
  columns: {
    date: { index: 0 },
    description: { index: 1 },
    amount: { index: 2 }
  },
  targetSheet: 'Amazonカード',
  sheetLayout: 'credit-card',
  hasOpeningBalance: false,
  defaultDebitAccount: '消耗品費',
  defaultCreditAccount: '未払金',
  defaultCreditSubAccount: '三井住友カード',
  mappingRules: []
};

async function testAll() {
  const dir = '/home/naoe/デスクトップ/青色申告/Amazonカード';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).map(f => path.join(dir, f));
  console.log(`Found ${files.length} CSV files.`);

  console.log('Parsing all files...');
  // npx ts-nodeで直接実行するために、このJSファイルを ts-node から require して走らせます。
}
