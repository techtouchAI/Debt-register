# زر الرجوع على أندرويد — تقرير قبل/بعد (السبب، الإصلاح، الأدلة)

> هذا الملف يوثّق عطلاً حقيقياً أُبلغ عنه بعد تثبيت آخر APK: **زر الرجوع يُغلق
> التطبيق فوراً** من أي شاشة داخلية بدل الرجوع إلى الشاشة السابقة.

## 1) العَرَض

- الكتابة داخل الحقول تعمل (إصلاح `captureInput` سليم).
- الضغط على زر الرجوع (أو إيماءة الرجوع) داخل أي صفحة داخلية ⇒ خروج كامل من
  التطبيق، بلا رجوع للصفحة السابقة وبلا أي حوار.

## 2) السبب الجذري (مُثبَت بالتجربة لا بالقراءة فقط)

كل حِزم `@capacitor/*` كانت مُعلنة في **`optionalDependencies` وحدها**:

```jsonc
// قبل
"optionalDependencies": {
  "@capacitor/android": "^8.5.2",
  "@capacitor/app": "^8.1.1",
  "@capacitor/core": "^8.5.2",
  // …
}
```

وأداة Capacitor تبني قائمة الإضافات الأصلية من `dependencies` و`devDependencies`
**فقط** (`getDependencies` في `@capacitor/cli`). لذلك كان `npx cap sync android`
ينتج مشروعاً بلا أي إضافة مسجَّلة — قياس فعلي على المشروع المولَّد:

| مخرج الأمر | قبل الإصلاح | بعد الإصلاح |
| --- | --- | --- |
| `android/app/src/main/assets/capacitor.plugins.json` | `[]` | `AppPlugin` + `FilesystemPlugin` + `LocalNotificationsPlugin` + `SharePlugin` |
| `android/capacitor.settings.gradle` | `:capacitor-android` فقط | `:capacitor-android` + `:capacitor-app` + 3 أخرى |
| `android/app/capacitor.build.gradle` | `dependencies { }` فارغة | `implementation project(':capacitor-app')` … |
| `MainActivity.java` | `class MainActivity extends BridgeActivity {}` | نفسها (بلا تغيير) |

الأثر على أندرويد (من شفرة Capacitor نفسه في `node_modules`):

- `AppPlugin.load()` يسجّل `OnBackPressedCallback` على النشاط
  (`getActivity().getOnBackPressedDispatcher().addCallback(...)`)، وهذا التسجيل
  **لا يحدث إطلاقاً** إذا لم تكن الإضافة مسجَّلة في `capacitor.plugins.json`.
- `BridgeActivity` لا يُعيد تعريف `onBackPressed`؛ فبلا أي `Callback` مسجَّل
  يعود زر الرجوع إلى سلوك النظام الافتراضي = `finish()` = خروج التطبيق.
- على مستوى JS: `App.addListener('backButton', …)` لا يصل إلى شيء، و
  `subscribeNativeBack` في `src/lib/nativeBridge.ts` يبتلع الخطأ (`console.warn`)
  فلا تظهر أي علامة على العطل في الواجهة أو الاختبارات.

**الخلاصة:** المشكلة لم تكن في منطق الرجوع داخل التطبيق، بل في أن حدث الرجوع
الأصلي لم يكن يصل إلى التطبيق من الأصل.

## 3) لماذا مرّت فحوص CI رغم أن الزر معطّل؟

1. **مهمة أندرويد** كانت تفحص المانيفست والأيقونات والصلاحيات والموارد **داخل
   الـ APK**، ولا تفحص إطلاقاً هل سُجِّلت الإضافات الأصلية (`capacitor.plugins.json`)
   أو هل بُنِي `:capacitor-app` داخل الحزمة.
2. **اختبارات الوحدة** كانت تحقن جسراً وهمياً (`setNativeBackSubscriber`) لتجربة
   منطق القرار، فلا تلمس تسلسل Capacitor الحقيقي ولا وجود `AppPlugin`.
3. لا يوجد اختبار على جهاز/محاكي، ولا تحقق من محتوى `classes.dex` في الحزمة.

## 4) الإصلاح

### أ) تسجيل الإضافات (السبب الجذري)

`package.json`: نقل الحِزم الأصلية إلى الموضع الذي تقرأه أداة Capacitor:

```jsonc
"dependencies": {
  "@capacitor/android": "^8.5.2",
  "@capacitor/app": "^8.1.1",
  "@capacitor/core": "^8.5.2",
  "@capacitor/filesystem": "^8.1.3",
  "@capacitor/local-notifications": "^8.3.1",
  "@capacitor/share": "^8.0.2"
},
"devDependencies": { "@capacitor/cli": "^8.5.2" },
"optionalDependencies": { "electron": "…", "electron-builder": "…" }
```

(إلكترون/electron-builder يبقيان `optionalDependencies` كما كانا — لا علاقة لهما
بتسجيل الإضافات، وتثبيتهما قد يفشل على منصات لا تحتاجهما.)

### ب) حارس رجوع مبكر (لا توجد لحظة بلا مستمع أصلي)

`src/lib/nativeBridge.ts` + `src/main.tsx`:

- `installNativeBackGuard()` يشترك في حدث `backButton` **قبل رسم الواجهة**، فيمنع
  النظام من إنهاء النشاط حتى قبل أن يصبح القرار جاهزاً، ثم يفوّض للمعالج النشط.
- `BootBackHandler` في `src/App.tsx` يغطّي مراحل ما قبل الموجّه (الإقلاع،
  التشغيل الأول، خطأ التخزين): الرجوع هناك يعرض حوار تأكيد الخروج بدل الإنهاء.

### ج) القرار الموحّد (كما كان مقصوداً في التطبيق، ومُتحقَّق منه الآن فعلياً)

| الحالة | السلوك |
| --- | --- |
| طبقة مفتوحة (نافذة/حوار) | تُغلق وحدها ولا يتغيّر المسار |
| صفحة داخلية | رجوع **شاشة واحدة** إلى الصفحة السابقة |
| مسار بلا سجل (فتح مباشر) | الصعود للصفحة الأم (استبدال لا دفع) |
| الرئيسية | حوار «الخروج من التطبيق؟» — لا خروج بضغطة واحدة |
| تأكيد المستخدم فقط | `App.exitApp()` (المسار الوحيد لإنهاء التطبيق) |

زر الرجوع الفيزيائي وإيماءة الرجوع يمرّان بنفس المسار: Capacitor يسجّل
`OnBackPressedCallback` (AndroidX) وهي تُستدعى دائماً — وتعمل أيضاً مع
`targetSdk 36` وإيماءة الرجوع التنبؤية (في Android 16+ لا يُستدعى
`onBackPressed` القديم، لكن `OnBackPressedCallback` يبقى يعمل).

## 5) الأدلة

| الدليل | النتيجة |
| --- | --- |
| `npm run verify` (تدقيق أغلفة + lint + typecheck + اختبارات + بناء) | **92 تدقيقاً ناجحاً، 0 فشل** + 18 ملف اختبار / **201 اختباراً** |
| `tests/androidBackPath.test.tsx` (جديد) | 11 اختباراً: 4 فحوص تسجيل إضافات، 3 فحوص الحارس، ومسارات الرجوع الفعلية |
| `scripts/android-back-e2e.mjs` (جديد، متصفح حقيقي على حزمة `dist`) | **16/16** — تفصيلها أدناه |
| CI: خطوة «التحقق من تسجيل الإضافات الأصلية بعد cap sync» | ✅ ناجحة (تُفشل المهمة إن غاب `AppPlugin` أو `:capacitor-app`) |
| CI: التحقق داخل الـ APK الموقَّع | ✅ ناجح: `assets/capacitor.plugins.json` يضم `com.capacitorjs.plugins.app.AppPlugin`، و`classes*.dex` يحتوي الصنف نفسه |

### تفصيل اختبار المتصفح الحقيقي (`scripts/android-back-e2e.mjs`)

يشغّل الحزمة المبنية (`dist/`) في Chromium فعلي، ويحاكي الطبقة الأصلية بنفس عقود
`native-bridge.js` ومنطق `AppPlugin.handleOnBackPressed` في Capacitor 8:

- بعد الإعداد: مستمعان أصليان مسجَّلان (الحارس + المعالج) — لا لحظة بلا مستمع.
- `#/invoices` ← فاتورة جديدة `#/invoices/new` ← فتح حوار «إضافة مادة جديدة»:
  - الرجوع ⇒ **يُغلق الحوار فقط** ويبقى المسار `#/invoices/new` (بلا خروج).
  - الرجوع ⇒ `#/invoices` (شاشة واحدة بالضبط).
  - الرجوع ⇒ `#/` ثم الرجوع ⇒ حوار تأكيد الخروج، و`exitApp` = 0.
  - تأكيد المستخدم ⇒ `exitApp` = 1 (مرة واحدة فقط).
- **السيناريو المضاد** (بلا `AppPlugin`، أي حالة ما قبل الإصلاح): الضغطة الواحدة
  تُنهي النشاط فوراً (`finish`) مع بقاء الواجهة على مسارها — إعادة إنتاج مطابقة
  للعطل المُبلَّغ عنه.

## 6) الاسم المحايد

| الموضع | قبل | بعد |
| --- | --- | --- |
| اسم التطبيق (أندرويد/شاشة البداية) | إدارة المكتب الزراعي | **إدارة المكتب** |
| عنوان الويب/PWA ووصفه | نظام إدارة المكتب الزراعي | إدارة المكتب |
| مُثبِّت ويندوز (electron-builder) | إدارة المكتب الزراعي | إدارة المكتب + `OfficeManager-*` |
| Tauri (سطح المكتب) | Agro Office / المكتب الزراعي | Office Manager + «إدارة المكتب — الفواتير والمخزون والديون» |
| الإشعارات | نظام المكتب الزراعي | إدارة المكتب / «تنبيهات المكتب» |
| أسماء نواتج CI | `AgriOffice-*` | `OfficeManager-*` |
| مجلد الحفظ على أندرويد | `Download/AgriOffice/` | `Download/OfficeManager/` |
| أمثلة المواد في الواجهة | «مبيد عناكب، سماد…» | «ابحث باسم المادة…» (بلا أمثلة قطاعية) |

**معرّفات لم تتغيّر عن قصد** (هوية بيانات وعقود تكامل — تغييرها يفقد بيانات أو
يكسر التحديث): `applicationId` = `com.agrioffice.debtregister`، قاعدة
`AgriOfficeDB`، مجلد النسخة المحمولة `AgriOfficeData`، قناة الإشعارات
`agri-office-default`، `TRAP_KEY`، اسم أيقونة الإشعار `ic_stat_agri`،
معرّف Tauri `ai.techtouch.agrooffice`.
كما أُضيف ترحيل شفّاف لمجلد بيانات ويندوز: إن وُجد مجلد بيانات باسم قديم
(`إدارة المكتب الزراعي` / `debt-register-agri-office`) يُستخدم كما هو، فلا يفقد
مستخدم قائم فواتيره وديونه بعد تغيير الاسم.

## 7) ما لم يتغيّر

- لا حذف أي ميزة، ولا تغيير في الواجهة، ولا في رقم الإصدار/البناء، ولا في
  `applicationId`/اسم الحزمة.
- لا تغيير في توقيع أي دالة عامة (أُضيفت دوال جديدة فقط في `nativeBridge.ts`).
- إصلاح الكتابة (`captureInput`) باقٍ كما هو، وحراسته في `prepare-android.mjs`
  ما زالت تُفشل البناء إن أُعيد تفعيله.
- Desktop (Electron/Tauri) و Web/PWA: نفس القرار الموحّد يعمل عبر فخّ السجل
  وزر الفأرة الخلفي/Alt+←، وبُنيت حزمها بنجاح في CI.

## 8) إعادة الفحوص محلياً

```bash
npm ci
npm run verify                      # تدقيق + lint + أنواع + اختبارات + بناء
npx cap add android && npx cap sync android
cat android/app/src/main/assets/capacitor.plugins.json   # يجب أن يضم AppPlugin

# اختبار المتصفح الحقيقي (يتطلب playwright-core ومتصفح chromium)
npm i --no-save playwright-core
CHROMIUM=/path/to/chrome node scripts/android-back-e2e.mjs
```
