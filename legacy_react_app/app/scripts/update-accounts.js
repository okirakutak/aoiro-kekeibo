// 勘定科目シートを整理するスクリプト
const ExcelJS = require('exceljs');

const ACCOUNTS = [
  // === 資産 (Assets) ===
  { id: 101, name: '現金',       kana: 'げんきん',             type: '資産' },
  { id: 102, name: '普通預金',   kana: 'ふつうよきん',         type: '資産' },
  { id: 103, name: '売掛金',     kana: 'うりかけきん',         type: '資産' },
  { id: 104, name: '車両運搬具', kana: 'しゃりょううんぱんぐ', type: '資産' },
  { id: 105, name: '工具器具備品', kana: 'こうぐきぐびひん',   type: '資産' },
  { id: 106, name: '敷金',       kana: 'しききん',             type: '資産' },
  { id: 107, name: '事業主貸',   kana: 'じぎょうぬしかし',     type: '資産' },

  // === 負債 (Liabilities) ===
  { id: 201, name: '未払金',     kana: 'みばらいきん',         type: '負債' },
  { id: 202, name: '借入金',     kana: 'かりいれきん',         type: '負債' },

  // === 資本 (Equity) ===
  { id: 301, name: '元入金',     kana: 'もといれきん',         type: '資本' },
  { id: 302, name: '事業主借',   kana: 'じぎょうぬしかり',     type: '資本' },

  // === 収益 (Revenue) ===
  { id: 401, name: '売上高',     kana: 'うりあげだか',         type: '収益' },
  { id: 402, name: '雑収入',     kana: 'ざつしゅうにゅう',     type: '収益' },

  // === 費用 (Expenses) ===
  { id: 501, name: '租税公課',   kana: 'そぜいこうか',         type: '費用' },
  { id: 502, name: '水道光熱費', kana: 'すいどうこうねつひ',   type: '費用' },
  { id: 503, name: '旅費交通費', kana: 'りょひこうつうひ',     type: '費用' },
  { id: 504, name: '通信費',     kana: 'つうしんひ',           type: '費用' },
  { id: 505, name: '接待交際費', kana: 'せったいこうさいひ',   type: '費用' },
  { id: 506, name: '損害保険料', kana: 'そんがいほけんりょう', type: '費用' },
  { id: 507, name: '消耗品費',   kana: 'しょうもうひんひ',     type: '費用' },
  { id: 508, name: '減価償却費', kana: 'げんかしょうきゃくひ', type: '費用' },
  { id: 509, name: '外注工賃',   kana: 'がいちゅうこうちん',   type: '費用' },
  { id: 510, name: '地代家賃',   kana: 'ちだいやちん',         type: '費用' },
  { id: 511, name: '支払手数料', kana: 'しはらいてすうりょう', type: '費用' },
  { id: 512, name: '雑費',       kana: 'ざっぴ',               type: '費用' },
  { id: 513, name: '新聞図書費', kana: 'しんぶんとしょひ',     type: '費用' },
  { id: 514, name: '車両費',     kana: 'しゃりょうひ',         type: '費用' },
  { id: 515, name: '研修費',     kana: 'けんしゅうひ',         type: '費用' },
  { id: 516, name: '会議費',     kana: 'かいぎひ',             type: '費用' },
  { id: 517, name: '諸会費',     kana: 'しょかいひ',           type: '費用' },
];

(async () => {
  const filePath = '/home/naoe/デスクトップ/青色申告/2025青色申告.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // 既存の勘定科目シートを取得
  let ws = wb.getWorksheet('勘定科目');
  if (!ws) {
    console.error('勘定科目シートが見つかりません');
    process.exit(1);
  }

  // 既存データをクリア（ヘッダ含む全行削除して再作成）
  const sheetIndex = ws.orderNo; // シートの位置を保持
  wb.removeWorksheet(ws.id);
  ws = wb.addWorksheet('勘定科目', { properties: { tabColor: { argb: 'FF4472C4' } } });

  // ヘッダ行
  ws.columns = [
    { header: 'id',   key: 'id',   width: 8  },
    { header: 'name', key: 'name', width: 16 },
    { header: 'kana', key: 'kana', width: 24 },
    { header: 'type', key: 'type', width: 10 },
  ];

  // データ行
  for (const acc of ACCOUNTS) {
    ws.addRow(acc);
  }

  // ヘッダ行のスタイル
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

  await wb.xlsx.writeFile(filePath);
  console.log(`勘定科目シートを更新しました（${ACCOUNTS.length}科目）`);
})();
