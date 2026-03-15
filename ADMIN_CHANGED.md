# تم تغيير Admin ID ✅

## المعلومات الجديدة

### Admin ID الجديد
```
6536561137
```

### Bot Token
```
8485920092:AAGL6pe1E3yqMfojnJi147iOhmhGHostStI
```

### Bot Username
```
@g_store_egypt_bot
```

## التغييرات المطبقة

1. ✅ تم تغيير ADMIN_ID في `config.js` إلى `6536561137`
2. ✅ البوت يعمل بنجاح على Windows
3. ✅ تم إنشاء ملف `TERMUX_SETUP.md` لحل مشكلة sqlite3 على Termux
4. ✅ تم إنشاء سكريبت `setup-termux.sh` للتثبيت السريع على Termux

## كيفية التشغيل على Termux

### الطريقة الأولى: استخدام السكريبت
```bash
chmod +x setup-termux.sh
./setup-termux.sh
```

### الطريقة الثانية: يدوياً
```bash
pkg update
pkg install nodejs python build-essential clang
rm -rf node_modules package-lock.json
npm install
node bot.js
```

## ملاحظات مهمة

- Admin ID الجديد: `6536561137`
- فقط هذا الـ ID يمكنه الوصول لقائمة الأدمن
- جميع الوظائف الإدارية متاحة فقط لهذا الـ ID
- البوت يعمل بنجاح على Windows
- لتشغيله على Termux، اتبع التعليمات في `TERMUX_SETUP.md`
