# 🏗️ دليل البناء الشامل

المصدر الوحيد للحقيقي: سير عمل واحد موحّد [`.github/workflows/build.yml`](.github/workflows/build.yml) يبني كل المنصات. (استُبدلت سير العمل القديمة `build-all` و`build-android` و`build-windows` بعد تفريغ منطق التوقيع والنشر منها ومن PR #1.)

## المتطلبات المحلية

- Node.js 20 أو أحدث + npm 10+
- للاندرويد (Capacitor): JDK 17 و Android SDK (Platform 34/35) — يثبتهما CI تلقائياً
- للـ Tauri: Rust stable، ولمسارات Windows أيضاً WebView2 وأدوات VSBuild

## 1) التطبيق الرئيسي (الويب + PWA)

```bash
npm ci          # تثبيت مطابق لقفل الحزم (lockfile متزامن الآن)
npm run dev     # خادم تطوير على http://localhost:5173
npm run build   # إنتاج → dist/ مع Service Worker وmanifest
npm run preview # معاينة نسخة الإنتاج
```

مهم: البناء يستخدم `base: './'` و`HashRouter`، لذلك يعمل `dist/` عند:
- فتح `dist/index.html` مباشرة عبر `file://`
- استضافته داخل مجلد فرعي
- تغليفه في Electron / Capacitor / Tauri

## 2) Windows — Electron

```bash
npm run build:windows   # electron-builder portable → release/*.exe
```

## 3) Android — Capacitor

```bash
npm run build:android   # يبني الويب، cap sync، ثم gradle assembleDebug
```

لإصدار موقع (كما في CI):

```bash
npm run build && npx cap add android && npx cap sync android
cd android && ./gradlew assembleRelease
```

## 4) Windows/Android خفيف — Tauri (اختياري)

```bash
cd desktop && npm ci
npm run build -- --bundles nsis,msi   # Windows (NSIS + MSI)
npm run android:init && npm run android:build   # Android APK
```

السكربتات في `desktop/` تبني التطبيق الجذري أولاً تلقائياً ثم تنسخ `dist/` إلى `desktop/src-tauri/dist/`، لذا الغلاف يغلّف التطبيق الكامل وليس نسخة تجريبية.

## 5) CI + التوقيع + النشر

عند الدفع إلى `main` أو فتح PR: تبني القطع الثلاث وتفشل بصوت عالٍ إن لم تُنتج ملفات (`if-no-files-found: error`) — لا بناءات خضراء فارغة كما في السابق.

للحصول على APK بتوقيع إنتاج ثابت أضف أسرار المستودع:

| Secret | الوصف |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة مرور keystore |
| `ANDROID_KEY_ALIAS` | اسم المفتاح |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح (اختياري) |

**الإصدارات:** `git tag vX.Y.Z && git push origin vX.Y.Z` ← تُرفع كل القطع تلقائياً إلى GitHub Release.

## 6) لماذا كان تظهر شاشة سوداء؟ (مرجع للمشرفين)

ثلاث علل متراكبة صُححت كلها:

1. **أصول بمسار مطلق** (`/assets/...`) مع Vite: تفشل تحت `file://` وأي مسار فرعي ← أُصلح بـ `base: './'`.
2. **BrowserRouter** على `file://`: إعادة التوجيه `/` ترمي `SecurityError` في pushState فيسقط React بدون أي رسالة ← استُبدل بـ `HashRouter`.
3. **تأخر تطبيق السمة** (useEffect بعد أول رسم) + غياب ErrorBoundary: وميض ثم خلفية داكنة فارغة ← وُضع وسم السمة قبل أول رسم في `index.html`، وأُضيف `ErrorBoundary` يعرض خطأً واضحاً مع أزرار استرجاع بدل الشاشة الصامتة.

كما أن تسجيل ServiceWorker اليدوي المكرر في `App.tsx` أزيل — الإضافة (vite-plugin-pwa) يسجل ويحدّث تلقائياً، وزر "مسح ذاكرة التخزين المؤقت" في شاشة الخطأ يعالج الكراك القديم.
