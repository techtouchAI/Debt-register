# 🏗️ دليل البناء الشامل

المصدر الوحيد للحقيقي: سير عمل واحد موحّد [`.github/workflows/build.yml`](.github/workflows/build.yml) يبني كل المنصات. (استُبدلت سير العمل القديمة `build-all` و`build-android` و`build-windows` بعد تفريغ منطق التوقيع والنشر منها ومن PR #1.)

## المتطلبات المحلية

- Node.js 20 أو أحدث + npm 10+
- للاندرويد (Capacitor): JDK 17 و Android SDK (Platform 34/35) — يثبتهما CI تلقائياً
- للـ Tauri: Rust stable، ولمسارات Windows أيضاً WebView2 (المثبّت يضمّن أداة التثبيت الصامتة) وأدوات VSBuild. Electron هو غلاف ويندوز الرسمي ولا يحتاج WebView2.

## 1) التطبيق الرئيسي (الويب + PWA)

```bash
npm ci          # تثبيت مطابق لقفل الحزم (lockfile متزامن الآن)
npm run dev     # خادم تطوير على http://localhost:5173
npm run build   # إنتاج → dist/ مع Service Worker وmanifest
npm run preview # معاينة نسخة الإنتاج
npm run verify  # تدقيق الأغلفة + ESLint + tsc + الاختبارات + البناء
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

## 4.1) التحقق من الأغلفة قبل البناء وبعده

```bash
npm run audit:shells   # فحوص ثابتة لأغلفة Electron/Capacitor/Tauri + ناتج الويب
npm run cap:prepare    # تجهيز مشروع أندرويد المُولَّد (صلاحيات + أيقونات + مسارات + أسماء)
```

`audit:shells` هو أول خطوة في `npm run verify` ويفشل (exit 1) عند أي نقص في إعداد
الأغلفة: صلاحيات الإشعارات، منع النص الصريح، أهداف NSIS/portable، أمان نافذة
Electron، أيقونات Tauri، أو مسارات مطلقة في `dist/`.

`cap:prepare` (وهو `scripts/prepare-android.mjs`) **idempotent**: يضيف الصلاحيات
(`POST_NOTIFICATIONS`، `READ/WRITE_EXTERNAL_STORAGE` بحدود `maxSdk`،
`SCHEDULE_EXACT_ALARM`) وأيقونة `ic_stat_agri` أحادية اللون، ويعلن **مزوّد الملفات**
(`androidx.core.content.FileProvider` بسلطة `${applicationId}.fileprovider` مع
`res/xml/file_paths.xml`)، ويزامن `app_name`، وينسخ **أيقونة التطبيق وشاشة البدء**
من `resources/android/res` (ويحذف صور `splash.png` القديمة من القالب)، ويتحقق من
`capacitor.config.json` — وإن تشغيله مرتين لا يُنتج أي فرق (يفحصه CI بـ `diff` على
المانيفست وكل الموارد، وتغطيه 19 حالة اختبار تشغّل السكربت فعلياً على مشروع مؤقت).

> **لماذا مزوّد الملفات إلزامي؟** `@capacitor/share` يحوّل رابط `file://` إلى
> `content://` عبر `FileProvider.getUriForFile(context, packageName + ".fileprovider", file)`؛
> وبلا مزوّد معلن بهذه السلطة في المانيفست يفشل `Share.share` كلياً — أي فشل
> حفظ/مشاركة ملفات PDF والنسخ الاحتياطية على الجهاز. المصدر الوحيد للحقيقة هو
> `resources/android/file_paths.xml`، وCI يقارنه بالمنسوخ داخل مشروع أندرويد.

وبعد البناء يتحقق CI من النواتج الفعلية لا من نجاح الأوامر فقط:

- **APK**: `aapt2 dump permissions/resources/xmltree` للتأكد من الصلاحيات وأيقونة
  الإشعارات وأيقونة التطبيق (الطبقة أحادية اللون والدائرية) وشاشة البدء المتجهة
  ومورد مسارات المزوّد ووجود `androidx.core.content.FileProvider`
  و`usesCleartextTraffic` داخل المانيفست المدمج، و`unzip -l` للتأكد من واجهة
  التطبيق داخل الـ APK، مع فحص `targetSdk ≥ 33` و`compileSdk ≥ 34`. كل تحقق
  يطبع سطراً يوضح ما فحصه، وعند الفشل يطبع مقتطفاً من الملف الذي فحصه.
- **مثبّت ويندوز**: فحص محتوى `app.asar`، تشغيل النسخة المحمولة باختبار دخان فعلي،
  ثم تثبيت صامت (`/S`) وتشغيل النسخة المثبّتة، وبعد إلغاء التثبيت يُتحقق من أن
  بيانات المكتب (IndexedDB في `%APPDATA%`) **لم تُحذف**.
- **Tauri**: بناء deb/AppImage وmsi/nsis، والتحقق من نسخ `dist/index.html`، ومن
  احتواء حزمة deb على ملف التنفيذ، ومن وجود واجهة التطبيق **داخل الثنائي**
  (`id="root"` — فـ Tauri يدمج الواجهة ولا يوزّع ملفات `dist`)، ومن سلامة ترويسة
  ELF في ملف AppImage.

في البيئات المقيّدة (بلا JDK/SDK/Wine/Rust أو مع شبكة تحجب مواقع التنزيل) لا يمكن
بناء APK/مثبّت محلياً؛ استخدم مهام CI أعلاه — وهي التي تُنتج القطع القابلة للاختبار
اليدوي على جهاز حقيقي.

## 4.2) أيقونة التطبيق

التصميم: **وصل بيع عاجي** بحافة مسننة وأسطر عربية وختم برونزي **«تم التسديد»** على
أخضر مريمي — الفواتير والقبض والديون بألوان هوية التطبيق. مصدره الوحيد ثلاثة ملفات
SVG في `resources/icon/`، وكل المقاسات والصيغ تُولَّد منها:

```bash
npm run icons              # يولّد كل النواتج (يكتب ما تغيّر فقط)
npm run icons -- --check   # يتحقق أن النواتج الملتزمة مطابقة للمصادر دون كتابة
```

| الملف المصدر | الاستخدام |
|---|---|
| `icon-background.svg` | الخلفية: تدرّج أخضر يمتد حتى الحواف (خلفية الأيقونة التكيفية) |
| `icon-foreground.svg` | الرمز بخلفية شفافة داخل منطقة الأمان (الطبقة الأمامية) |
| `icon-small.svg` | نسخة مبسّطة بأسطر أسمك للأحجام ≤ 40 بكسل (favicon وشريط المهام)، كل حوافها المستقيمة على مضاعفات 64 وحدة (= بكسل كامل عند 16×16) لتبقى حادة — يتحقق منها اختبار |

| النظام | النواتج (مُولَّدة — لا تُعدَّل يدوياً) |
|---|---|
| الويب/PWA | `public/favicon.svg` و`favicon.ico` و`apple-touch-icon.png` و`pwa-192x192.png` و`pwa-512x512.png` (any) و`pwa-maskable-512x512.png` (maskable) |
| Windows — Electron | `resources/icon/app.ico` (16 → 256 بكسل) — `win.icon` في `electron-builder.json` |
| Tauri | `desktop/src-tauri/icons/*` (ico وicns وPNG وأيقونات iOS/Android) |
| Android — Capacitor | `resources/android/res/**`: أيقونة تكيفية (خلفية متجهة + رمز + طبقة أحادية اللون للأيقونات ذات السمة في أندرويد 13+)، أيقونة قديمة ودائرية لكل الكثافات، وشاشة بدء (لون ثابت + الشعار في المنتصف، نهاري وليلي)؛ و`resources/android/ic_stat_agri.xml` لأيقونة الإشعارات |

موارد أندرويد لا توضع في مجلد `android/` (مُولَّد ومتجاهَل في git) بل ينسخها
`npm run cap:prepare` بعد `npx cap add android`. وهو يحذف صور `splash.png` التي يأتي
بها قالب Capacitor، لأن بقاء `drawable/splash.png` بجانب `drawable/splash.xml` مورد
مكرر يُفشل البناء (`resource 'drawable/splash' has a conflicting value`)، ولأن تلك
الصور تُمطّ على الشاشات بنِسب مختلفة.

لتعديل الأيقونة: عدّل ملفات `resources/icon/*.svg` (وإن غيّرت أبعاد الوصل أو الختم
فحدّث `GLYPH_SPEC` في `scripts/generate-icons.mjs`، فمنه تُرسم الطبقة أحادية اللون
وأيقونة الإشعارات)، ثم نفّذ `npm run icons` والتزم بالنواتج. `tests/appIcons.test.ts`
يفشل إن نُسي التوليد أو نقص مقاس أو انقطع ربط الأيقونة في أي غلاف.

## 5) CI + التوقيع + النشر

عند الدفع إلى `main` أو فتح PR: تبني القطع الثلاث وتفشل بصوت عالٍ إن لم تُنتج ملفات (`if-no-files-found: error`) — لا بناءات خضراء فارغة كما في السابق.

للحصول على APK بتوقيع إنتاج ثابت أضف أسرار المستودع:

| Secret | الوصف |
|---|---|
| `KEYSTORE_BASE64` | ملف PKCS12 مشفّر بـ Base64 كسطر واحد |
| `KEYSTORE_STORE_PASSWORD` | كلمة مرور مخزن التوقيع |
| `KEYSTORE_KEY_ALIAS` | اسم المفتاح داخل المخزن |
| `KEYSTORE_KEY_PASSWORD` | كلمة مرور المفتاح |

**الإصدارات:** `git tag vX.Y.Z && git push origin vX.Y.Z` ← تُرفع كل القطع تلقائياً إلى GitHub Release.

## 6) لماذا كان تظهر شاشة سوداء؟ (مرجع للمشرفين)

ثلاث علل متراكبة صُححت كلها:

1. **أصول بمسار مطلق** (`/assets/...`) مع Vite: تفشل تحت `file://` وأي مسار فرعي ← أُصلح بـ `base: './'`.
2. **BrowserRouter** على `file://`: إعادة التوجيه `/` ترمي `SecurityError` في pushState فيسقط React بدون أي رسالة ← استُبدل بـ `HashRouter`.
3. **تأخر تطبيق السمة** (useEffect بعد أول رسم) + غياب ErrorBoundary: وميض ثم خلفية داكنة فارغة ← وُضع وسم السمة قبل أول رسم في `index.html`، وأُضيف `ErrorBoundary` يعرض خطأً واضحاً مع أزرار استرجاع بدل الشاشة الصامتة.

كما أن تسجيل ServiceWorker اليدوي المكرر في `App.tsx` أزيل — الإضافة (vite-plugin-pwa) يسجل ويحدّث تلقائياً، وزر "مسح ذاكرة التخزين المؤقت" في شاشة الخطأ يعالج الكراك القديم.
