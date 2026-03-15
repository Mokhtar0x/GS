# Telegram Bot V2 (SQLite + Termux)

## ما الذي تغير؟
- تم استبدال التخزين عبر JSON بقاعدة **SQLite** أسرع وأكثر ثباتاً.
- عند أول تشغيل سيتم **ترحيل البيانات تلقائياً** من `bot_data.json` إلى `bot_database.db`.
- تم الحفاظ على نفس دوال قاعدة البيانات المستخدمة داخل `bot.js` حتى لا يتكسر المشروع.
- تم إضافة **Indexes + WAL + cache tuning** لتحسين الأداء.
- المشروع يعمل على **Termux**، ويفضل استخدام **Node.js 22+** للاستفادة من `node:sqlite` المدمج بدون تثبيت مكتبات SQLite إضافية.

## ملفات مهمة
- `database-file.js` → طبقة قاعدة البيانات الجديدة (SQLite)
- `database-file-legacy-json.js` → النسخة القديمة المعتمدة على JSON للاحتياط
- `bot_database.db` → سيتم إنشاؤه تلقائياً عند أول تشغيل
- `bot_data.json.migrated.bak` → نسخة احتياطية من بيانات JSON بعد الترحيل

## التشغيل على Termux
```bash
pkg update -y
pkg install nodejs-lts -y
cd ~/GSPRO
bash setup-termux.sh
nano .env
bash start-termux.sh
```

## ملاحظات مهمة
- يفضل أن يكون المشروع داخل `~/` في Termux وليس داخل `/storage/emulated/0`.
- لو كان إصدار Node أقل من 22 فالمشروع سيطلب منك تثبيت `better-sqlite3` أو `sqlite3` كبديل.
- أول تشغيل قد يأخذ وقتاً إضافياً بسيطاً بسبب ترحيل البيانات من JSON إلى SQLite.

## الأوامر
```bash
npm run migrate        # يجهز SQLite/ينفذ الترحيل
npm run setup:termux   # إعداد البيئة على Termux
npm run start:termux   # تشغيل البوت في وضع Termux
npm start              # تشغيل عادي
```
