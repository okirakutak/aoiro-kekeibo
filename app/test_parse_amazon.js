const { parseFiles } = require('./dist-electron/main.js');
// dist-electron/main.js を介さずに、config-parser-engine.ts の中身をテストします。
// TSコンパイラの設定エラー等を避けるため、テストスクリプト内で関数を直接requireして実行します。
