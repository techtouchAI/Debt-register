# دليل بناء تطبيقات Android و Windows

## Android APK - خطوات البناء

### المتطلبات
- Node.js 18+
- Android Studio (مع Android SDK)
- JDK 17

### الخطوات
```bash
# 1. تثبيت الاعتمادات
npm install

# 2. بناء الويب
npm run build

# 3. تثبيت Capacitor (إذا لم يكن مثبت)
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem @capacitor/local-notifications

# 4. تهيئة Capacitor (مرة واحدة)
npx cap init "إدارة المكتب الزراعي" com.agrioffice.debtregister --web-dir=dist

# 5. إضافة Android
npx cap add android

# 6. نسخ البناء
npx cap sync android

# 7. فتح في Android Studio
npx cap open android

# في Android Studio:
# Build > Build Bundle(s) / APK(s) > Build APK(s)
# APK سيكون في: android/app/build/outputs/apk/debug/app-debug.apk
```

### مميزات Android
- ✅ حفظ النسخ في Download/AgriOffice/ مع اسم المكتب والتاريخ
- ✅ إشعارات منبثقة خارج التطبيق
- ✅ يعمل بدون انترنت 100%
- ✅ أيقونة خضراء مع حرف م

---

## Windows 10/11 - خطوات البناء

### المتطلبات
- Node.js 18+
- Windows 10/11
- (اختياري) electron-builder

### الخطوات
```bash
# 1. تثبيت الاعتمادات
npm install

# 2. تثبيت Electron
npm install electron electron-builder --save-dev

# 3. بناء الويب
npm run build

# 4. بناء مثبت Windows
npx electron-builder --win --x64

# أو عبر npm script:
npm run electron:build

# الناتج في مجلد release/:
# - إدارة المكتب الزراعي Setup 1.0.0.exe (مثبت)
# - إدارة المكتب الزراعي Portable.exe (محمول بدون تثبيت)
```

### مميزات Windows
- ✅ مثبت NSIS احترافي مع اختصارات
- ✅ حفظ النسخ عبر حوار حفظ Windows في Downloads/AgriOffice/
- ✅ إشعارات نظام Windows 10/11
- ✅ يعمل بدون انترنت
- ✅ متوافق مع Windows 10 و 11 x64

### ملفات Electron
- `electron/main.js`: النافذة الرئيسية (1400x900، تكبير تلقائي)
- `electron/preload.js`: جسر آمن
- `electron-builder.json`: إعدادات البناء

### تشغيل في وضع التطوير
```bash
npm run dev          # في terminal 1
npm run electron     # في terminal 2 (بعد تشغيل dev)
# أو
npm run electron:dev # يشغل الاثنين معاً
```

---

## PWA - تطبيق ويب تقدمي (يعمل بدون انترنت)

التطبيق هو PWA كامل:
- Service Worker يخزن جميع الملفات
- يعمل بدون انترنت بعد أول زيارة
- يمكن تثبيته كتطبيق على Android و Windows من المتصفح
- Manifest مع أيقونات وأسماء عربية

```bash
npm run build
npm run preview
# ثم افتح http://localhost:4173
# في المتصفح: تثبيت التطبيق من شريط العنوان
```

---

## النسخ الاحتياطي - تفاصيل التنفيذ

### كما طلبت:
- **المجلد**: Downloads/AgriOffice/ (أو Download/AgriOffice/ على Android)
- **الاسم**: اسم_المكتب_Backup_تاريخ_وقت.json
- **مثال**: المكتب_الزراعي_Backup_2024-01-15_14-30-00.json
- **عند الاستيراد**: يتم إنشاء مجلد خاص ونسخة تلقائية بتاريخ الاستيراد
- **تلقائي**: كل 30 دقيقة/ساعة/يومياً حسب الإعداد

### الكود:
- `src/lib/backup.ts`: منطق التصدير/الاستيراد/التلقائي
- يحاول: Capacitor Filesystem (Android) → Electron (Windows) → Browser Download (Web)
- جميعها تعمل بدون انترنت

---

## الإشعارات - تفاصيل التنفيذ

### كما طلبت:
- **داخل التطبيق**: جدول notifications في IndexedDB + جرس مع عداد
- **خارج التطبيق**:
  - Android: Capacitor LocalNotifications → إشعار منبثق في شريط النظام
  - Windows: Electron Notification + Web Notification API → إشعار منبثق Windows 10/11
  - Web: Web Notifications API → إشعار متصفح

### الكود:
- `src/lib/db.ts`: createNotification() تحاول جميع الطرق
- `src/pages/Notifications.tsx`: واجهة عرض الإشعارات

---

## ملاحظات إضافية

- التطبيق لا يحتاج انترنت أبداً - تم حذف أي ميزة تحتاج نت (تسجيل دخول سحابي...)
- المستخدمون محليون فقط (PIN) - بدون انترنت
- جميع البيانات قابلة للتعديل والحذف
- الوضع الليلي/النهاري في الإعدادات + localStorage
- لوحة تحكم بأزرار كبيرة: فاتورة جديدة، تسديد دين، إضافة مادة، الزبائن والديون
