# المكتب الزراعي — Debt Register

تطبيق عربي محلي لإدارة المكتب الزراعي والفواتير والمخزون وحسابات الزبائن والديون. يعمل كتطبيق ويب تقدمي **PWA** دون إنترنت، ويُغلّف بواسطة **Tauri v2** كتطبيق أندرويد وبرنامج أصلي لويندوز 10 و11.

## التشغيل محلياً

يتطلب Node.js 20 أو أحدث:

```bash
npm start
```

ثم افتح `http://localhost:8080`. لا يحتاج التطبيق إلى خادم أو قاعدة بيانات خارجية.

## تطوير تطبيق Tauri

يتطلب Rust ومتطلبات Tauri الخاصة بالنظام:

```bash
cd desktop
npm ci
npm run dev
```

بناء Windows:

```bash
npm run build -- --bundles nsis,msi
```

بناء Android بعد تثبيت Android Studio/SDK/NDK:

```bash
npm run android:init
npm run android:build
```

## GitHub Actions

سير العمل [`.github/workflows/build.yml`](.github/workflows/build.yml) يعمل تلقائياً عند الدفع وطلبات الدمج، ويمكن تشغيله يدوياً من تبويب **Actions**. وهو ينتج:

- `agro-office-android-apk`: ملف APK قابل للتثبيت.
- `agro-office-windows-10-11`: مثبت NSIS بصيغة EXE ومثبت WiX بصيغة MSI.
- عند دفع وسم مثل `v1.0.0`، تُرفق الملفات تلقائياً في GitHub Release.

### توقيع Android للإصدارات الدائمة

لتكون التحديثات المستقبلية قابلة للتثبيت فوق النسخة السابقة، أضف أسرار المستودع التالية:

| Secret | الوصف |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | ملف keystore مشفّر بـ Base64 كسطر واحد |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة مرور keystore |
| `ANDROID_KEY_ALIAS` | اسم المفتاح |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح (اختياري إن كانت نفسها) |

إذا لم تتوفر الأسرار، ينشئ سير العمل مفتاح CI مؤقتاً حتى يظل APK الناتج قابلاً للتثبيت للاختبار. لا يمكن تحديث APK موقع بمفتاح مؤقت بإصدار من تشغيل آخر دون إزالة النسخة السابقة.

مثال إنشاء قيمة Base64:

```bash
base64 -w 0 release.jks
```

## بنية المشروع

- `index.html`, `css/`, `js/`: واجهة الويب المحلية.
- `manifest.webmanifest`, `sw.js`: دعم التثبيت والعمل دون إنترنت.
- `desktop/`: مشروع Tauri v2 لنظامي Windows وAndroid.
- `icons/`: أيقونات PWA؛ أما أيقونات الأنظمة الأصلية فتوجد في `desktop/src-tauri/icons/`.
