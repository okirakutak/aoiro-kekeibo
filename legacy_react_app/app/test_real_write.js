const { writeTransactionsToSheet } = require('./dist-electron/main.js');
// main.js を介して本物の関数を呼び出す
// もし dist-electron/main.js のロードで electron エラーが起きる場合は、
// ts-node 等を使って直接 typescript ファイルを実行します。

const data = [
  {
    date: new Date('2025/03/06'),
    debitAccount: '',
    debitSubAccount: '',
    creditAccount: '',
    creditSubAccount: '',
    description: 'た*く様 Xiaomi Redmi Note 10 Pro ジャンク品 動作不安',
    amount: 7000,
    memo: ''
  }
];

// 直接 typescript ファイルを実行するために、ts-node環境で試します。
