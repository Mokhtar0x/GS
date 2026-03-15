#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[INFO] تم إنشاء .env من .env.example"
  echo "[INFO] عدّل القيم أولاً ثم أعد تشغيل الأمر"
  exit 0
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] يلزم Node.js 18 على الأقل"
  exit 1
fi

npm install --omit=optional

node - <<'NODE'
const Database = require('./database-file');
const db = new Database();
console.log(`✅ SQLite ready via ${db.driver}`);
NODE

echo "🚀 Starting bot in Termux mode..."
export TERMUX_MODE=true
node bot.js
