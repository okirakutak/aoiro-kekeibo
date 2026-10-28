#!/bin/bash
# 青色家計簿 legacy_react_app 起動スクリプト
# 使い方: ./dev.sh
# legacy_react_app/app ディレクトリに移動して npm run dev を実行します

set -e

# このスクリプトのあるディレクトリを基準に app ディレクトリを求める
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/legacy_react_app/app"

# app ディレクトリの存在確認
if [ ! -d "$APP_DIR" ]; then
  echo "エラー: アプリディレクトリが見つかりません: $APP_DIR" >&2
  exit 1
fi

# package.json の存在確認
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "エラー: package.json が見つかりません: $APP_DIR/package.json" >&2
  exit 1
fi

cd "$APP_DIR"
npm run dev
