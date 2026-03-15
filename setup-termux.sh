#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"

echo "🚀 تجهيز المشروع على Termux مع SQLite"
echo

case "$PWD" in
  /storage/*|/sdcard/*)
    echo "⚠️ يفضل نقل المشروع إلى HOME داخل Termux لتجنب مشاكل الصلاحيات والـ symlink مع npm"
    echo "   مثال: mv \"$PWD\" \"$HOME/GSPRO\""
    echo
    ;;
esac

echo "📦 تحديث الحزم..."
pkg update -y

echo "⚙️ تثبيت المتطلبات الأساسية..."
pkg install -y nodejs-lts python make clang pkg-config libsqlite

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "📝 تم إنشاء ملف .env من .env.example"
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
echo "🧠 إصدار Node الحالي: $(node -v)"

if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "⚠️ يفضل استخدام Node.js 22+ لأن المشروع يعتمد على node:sqlite بدون مكتبات إضافية"
  echo "   لو ستبقى على إصدار أقدم، ثبّت better-sqlite3 أو sqlite3 يدوياً."
  mkdir -p "$HOME/.gyp"
  cat > "$HOME/.gyp/include.gypi" <<'GYP'
{
  'variables': {
    'android_ndk_path': ''
  }
}
GYP
fi

echo "📥 تثبيت مكتبات المشروع..."
npm install --omit=optional

echo
echo "✅ تم الإعداد بنجاح"
echo "▶️ شغل البوت بالأمر: bash start-termux.sh"
