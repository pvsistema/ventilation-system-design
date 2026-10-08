#!/bin/bash
# Сборка сайта для зеркала: все запросы программы идут на тот же домен
# (/api/...), а не на poehali.dev.
#   bash mirror-server/build_site.sh
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  exit 1
fi

echo "== Установка библиотек сайта (2-5 минут) =="
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

echo "== Сборка =="
# VITE_API_BASE="/" = «тот же домен».
export VITE_API_BASE="/"
NODE_OPTIONS=--max-old-space-size=3072 npx vite build

python3 mirror-server/postbuild.py
echo "== Сайт собран: $(pwd)/dist =="