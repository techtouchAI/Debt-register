#!/usr/bin/env node
/**
 * تدقيق أغلفة التشغيل (أندرويد/ويندوز/تيوري) قبل أي بناء.
 *
 * الهدف: منع تسليم نسخة "تُبنى بنجاح" لكنها معطوبة على الجهاز:
 *   - APK بلا صلاحية إشعارات ⇒ لا إشعارات أبداً.
 *   - APK يمنع النص الصريح لكنه يشير لأيقونة غير موجودة ⇒ شريط حالة أبيض.
 *   - NSIS/portable بإعداد ناقص ⇒ بيانات تُمسح عند كل تشغيل (نسخة محمولة).
 *   - Tauri ناقص المعرّف/الأيقونات/الصلاحيات ⇒ فشل بناء أو تطبيق بلا إشعارات.
 *   - أيقونة تطبيق ناقصة ⇒ أيقونة Capacitor الافتراضية على أندرويد أو شاشة بدء ممطوطة.
 *   - واجهة مبنية بمسارات مطلقة ⇒ شاشة بيضاء تحت file:// داخل الأغلفة.
 *
 * هذا فحص ثابت (لا يحتاج JDK/SDK/Wine) لذلك يعمل في أي بيئة، بينما الفحوص
 * الديناميكية (تحليل APK، تشغيل المثبّت، بناء Tauri) تتم في CI على النواتج
 * الفعلية.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
let failures = 0;
let warnings = 0;

function check(description, condition) {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${description}`);
  } else {
    failures += 1;
    console.log(`  ✖ ${description}`);
  }
}

function warn(description, condition) {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${description}`);
  } else {
    warnings += 1;
    console.log(`  ⚠ ${description}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'));
}

async function readText(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

/**
 * كل حِزم `@capacitor/*` التي تستوردها شيفرة التطبيق.
 *
 * أداة Capacitor تسجّل الإضافات الأصلية في مشروع أندرويد انطلاقاً من
 * `dependencies` و`devDependencies` فقط (getDependencies في @capacitor/cli).
 * أي إضافة أصلية خارج هاتين القائمتين — ولو كانت في `optionalDependencies` —
 * لا يراها `cap sync`، فلا تُبنى داخل الـ APK، وينفّذ النظام سلوكه الافتراضي.
 * هذا بالضبط ما جعل زر الرجوع يُنهي التطبيق فوراً: بلا `AppPlugin` لا يوجد
 * `OnBackPressedCallback` مسجَّل، فيستدعي النظام `finish()`.
 */
async function capacitorPackagesImportedBySource() {
  const found = new Set();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      for (const match of text.matchAll(/from '(@capacitor\/[a-z-]+)'/g)) found.add(match[1]);
    }
  };
  await walk(join(repoRoot, 'src'));
  return [...found].sort();
}

async function main() {
  const pkg = await readJson('package.json');
  const capacitor = await readJson('capacitor.config.json');
  const builder = await readJson('electron-builder.json');
  const tauri = await readJson('desktop/src-tauri/tauri.conf.json');
  const mainCjs = await readText('electron/main.cjs');
  const preloadCjs = await readText('electron/preload.cjs');
  const indexHtml = await readText('index.html');
  const themeBootstrap = await readText('src/themeBootstrap.ts');
  const prepareAndroid = await readText('scripts/prepare-android.mjs');
  const appTsx = await readText('src/App.tsx');
  const prepareAndroidTests = await readText('tests/prepareAndroid.test.ts');
  const workflow = await readText('.github/workflows/build.yml');

  /* ---------------------------- عام ---------------------------- */
  section('إعداد الحزمة');
  check('سكربت بناء الويب موجود', typeof pkg.scripts?.build === 'string');
  check('سكربت الاختبارات موجود', typeof pkg.scripts?.test === 'string');
  check('اختبار الدخان لسطح المكتب موثّق', /--smoke-test/.test(mainCjs));
  check(
    'اختبار الدخان ينتظر جاهزية قاعدة البيانات لا مجرد رسم الواجهة',
    /waitForAppReady/.test(mainCjs) && /indexedDB\.databases\(\)/.test(mainCjs) && /data-app-boot/.test(appTsx)
  );

  /* --------------------------- إلكترون --------------------------- */
  section('إلكترون (ويندوز)');
  const prefs = mainCjs.slice(mainCjs.indexOf('webPreferences'), mainCjs.indexOf('webPreferences') + 400);
  check('contextIsolation مفعّل', /contextIsolation:\s*true/.test(prefs));
  check('nodeIntegration معطّل', /nodeIntegration:\s*false/.test(prefs));
  check('sandbox مفعّل', /sandbox:\s*true/.test(prefs));
  check('preload محدّد', /preload:\s*path\.join/.test(prefs));
  check('منع النوافذ الفرعية (setWindowOpenHandler)', /setWindowOpenHandler/.test(mainCjs));
  check('تحويل الروابط الخارجية للمتصفح', /shell\.openExternal/.test(mainCjs));
  check('منع <webview>', /will-attach-webview/.test(mainCjs));
  check('مُعالج أذونات صريح (allowlist)', /setPermissionRequestHandler/.test(mainCjs));
  check('نسخة وحيدة من التطبيق', /requestSingleInstanceLock/.test(mainCjs));
  check('مجلد بيانات ثابت في النسخة المحمولة', /PORTABLE_EXECUTABLE_DIR/.test(mainCjs) && /setPath\('userData'/.test(mainCjs));
  check('معرّف التطبيق على ويندوز (إشعارات)', /setAppUserModelId\('com\.agrioffice\.debtregister'\)/.test(mainCjs));
  check('كتابة ذرّية للملفات (tmp ثم rename)', /\.tmp`/.test(mainCjs) && /fsp\.rename/.test(mainCjs));
  check('حماية من اجتياز المسار في أسماء الملفات', /function safeFileName/.test(mainCjs));
  check('جسر preload محدود بالدوال المعلنة', /contextBridge\.exposeInMainWorld/.test(preloadCjs));
  check('لا استخدام ipcRenderer مباشر في الواجهة', !/ipcRenderer/.test(preloadCjs.split('contextBridge')[0] ?? ''));
  check(
    'قنوات IPC تتحقق من أن الطلب من صفحة التطبيق الموثوقة',
    /function isTrustedIpcSender/.test(mainCjs) &&
      ['save-backup', 'save-file', 'print-document', 'show-notification', 'app-info'].every((channel) =>
        new RegExp(`rejectUntrustedIpc\\(event, '${channel}'\\)`).test(mainCjs)
      )
  );
  check(
    'خادم التطوير المسموح محدد بالمنفذ المعروف (لا أي localhost)',
    /url\.protocol === 'http:' && url\.hostname === 'localhost' && url\.port === '5173'/.test(mainCjs)
  );
  check(
    'اسم الملف يرفض فواصل Windows وPOSIX قبل الكتابة',
    mainCjs.includes('/[\\\\/]/.test(fileName)') && mainCjs.includes("fileName.includes('\\0')")
  );
  check(
    'الحفظ الذري يستعمل ملفاً مؤقتاً فريداً وينظفه بعد الفشل',
    /randomUUID\(\)/.test(mainCjs) && /function writeFileAtomically/.test(mainCjs) && /fsp\.rm\(tempPath, \{ force: true \}\)/.test(mainCjs)
  );

  check('appId صحيح', builder.appId === 'com.agrioffice.debtregister');
  check('asar مفعّل', builder.asar === true);
  check('مجلد النواتج release', builder.directories?.output === 'release');
  check('حزمة البناء تتضمن dist و electron و public', ['dist/**/*', 'electron/**/*', 'public/**/*'].every((pattern) => builder.files?.includes(pattern)));
  check('هدف nsis موجود', JSON.stringify(builder.win?.target ?? '').includes('nsis'));
  check('هدف portable موجود', JSON.stringify(builder.win?.target ?? '').includes('portable'));
  check('اسم ملف المثبّت واضح', /Setup/.test(JSON.stringify(builder.nsis?.artifactName ?? '')));
  check('اسم ملف النسخة المحمولة واضح', /Portable/.test(JSON.stringify(builder.portable?.artifactName ?? '')));
  check('لا يُحذف مجلد بيانات المستخدم عند إلغاء التثبيت', builder.nsis?.deleteAppDataOnUninstall === false);
  check('أيقونة ويندوز موجودة', existsSync(join(repoRoot, builder.win?.icon ?? '')));
  check('أيقونة ويندوز ملف ICO متعدد المقاسات (المثبّت والاختصارات وشريط المهام)', /\.ico$/.test(builder.win?.icon ?? ''));
  check('صفحة الخطأ العربية لتعذّر التحميل موجودة', /تعذّر تحميل واجهة التطبيق/.test(mainCjs));
  check('صفحة الخطأ لا تعرض الوصف الإنجليزي التقني من Chromium', !/\$\{errorDescription\}/.test(mainCjs));
  check(
    'واجهة الإنتاج لديها CSP تمنع السكربتات المضمّنة والمصادر الخارجية',
    /http-equiv="Content-Security-Policy"/.test(indexHtml) &&
      /script-src 'self'/.test(indexHtml) &&
      !/script-src[^\"]*unsafe-inline/.test(indexHtml)
  );
  check(
    'تهيئة السمة ملف مستقل لا سكربت مضمّن',
    /src="\/src\/themeBootstrap\.ts"/.test(indexHtml) &&
      /localStorage\.getItem\('theme'\)/.test(themeBootstrap) &&
      !/<script>([\s\S]*?)localStorage\.getItem\('theme'\)/.test(indexHtml)
  );
  check('لغة Chromium عربية (رسائل التحقق ومنتقي التاريخ) عبر --lang=ar', /appendSwitch\('lang', 'ar'\)/.test(mainCjs));
  check('لا قائمة Electron الإنجليزية الافتراضية (File/Edit/View)', /Menu\.setApplicationMenu\(null\)/.test(mainCjs));
  check(
    'قائمة الزر الأيمن عربية (قص/نسخ/لصق) للفأرة على ويندوز',
    /context-menu/.test(mainCjs) && /label: 'قص'/.test(mainCjs) && /label: 'لصق'/.test(mainCjs) && /label: 'تحديد الكل'/.test(mainCjs)
  );
  check(
    'التكبير بـ Ctrl + عجلة الفأرة و Ctrl +/-/0 مع حفظه بين مرات التشغيل',
    /zoom-changed/.test(mainCjs) && /before-input-event/.test(mainCjs) && /window-state\.json/.test(mainCjs)
  );
  check(
    'أنواع الملفات في صندوق الحفظ بالعربية (لا PDF/JSON)',
    !/name: 'PDF'/.test(mainCjs) && !/name: 'JSON'/.test(mainCjs) && /name: 'مستند'/.test(mainCjs) && /name: 'جدول بيانات'/.test(mainCjs)
  );
  check('مجلد الحفظ المقترح باسم عربي (التنزيلات/إدارة المكتب)', /const APP_FOLDER = 'إدارة المكتب'/.test(mainCjs) && !/'OfficeManager'\)/.test(mainCjs));
  check('النقر على الإشعار يُظهر نافذة التطبيق (مثل أندرويد)', /notification\.on\('click'/.test(mainCjs));
  check(
    'التنقّل مسموح لصفحة التطبيق فقط (إفلات ملف لا يستبدل الواجهة)',
    /pathToFileURL\(APP_INDEX\)/.test(mainCjs) && !/if \(url\.protocol === 'file:'\) return true;/.test(mainCjs)
  );

  /* --------------------------- أندرويد --------------------------- */
  section('أندرويد (Capacitor)');
  check('appId صحيح', capacitor.appId === 'com.agrioffice.debtregister');
  check('webDir = dist', capacitor.webDir === 'dist');
  check('androidScheme = https', capacitor.server?.androidScheme === 'https');
  check('allowMixedContent معطّل', capacitor.android?.allowMixedContent === false);
  check(
    'captureInput معطّل (المحرر الأصلي للوحة المفاتيح — لا حذف كلمات أثناء الكتابة)',
    !capacitor.android?.captureInput
  );
  const iconAsset = (await fileText(join(repoRoot, 'resources/android/ic_stat_agri.xml'))) ?? '';
  check(
    'أيقونة الإشعارات محدّدة ومتاحة',
    capacitor.plugins?.LocalNotifications?.smallIcon === 'ic_stat_agri' && iconAsset.length > 0
  );
  check(
    'أيقونة الإشعارات أحادية اللون (tint + fillColor أبيض)',
    /android:tint="#FFFFFFFF"/.test(iconAsset) && /android:fillColor="#FFFFFFFF"/.test(iconAsset)
  );
  check('لا إشارة إلى ملف صوت غير موجود', !capacitor.plugins?.LocalNotifications?.sound);
  check(
    'صلاحية التخزين صريحة في إعداد Capacitor',
    capacitor.plugins?.Filesystem?.androidRequestPermissions === true
  );
  const capacitorImports = await capacitorPackagesImportedBySource();
  const capSyncVisible = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {})
  ]);
  const optionalDeps = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  check(
    'كل إضافة @capacitor يستوردها الكود مُعلنة في dependencies/devDependencies (يرى cap sync الإضافات هناك فقط)',
    capacitorImports.length > 0 && capacitorImports.every((name) => capSyncVisible.has(name))
  );
  check(
    'إضافات الرجوع والملفات والإشعارات ليست في optionalDependencies (كانت تُسقط تسجيل الإضافات كلياً)',
    ['@capacitor/app', '@capacitor/core', '@capacitor/android', '@capacitor/filesystem', '@capacitor/local-notifications', '@capacitor/share'].every(
      (name) => !optionalDeps.has(name)
    )
  );
  const mainTsx = await readText('src/main.tsx');
  const nativeBridge = await readText('src/lib/nativeBridge.ts');
  const backHandlers = await readText('src/components/BackNavigationHandler.tsx');
  check(
    'حارس الرجوع الأصلي مثبَّت قبل رسم الواجهة (لا خروج أثناء الإقلاع)',
    /installNativeBackGuard\(\)/.test(mainTsx) && /export function installNativeBackGuard/.test(nativeBridge)
  );
  check(
    'الرجوع الأصلي يستخدم واجهة @capacitor/app الرسمية (backButton)',
    /App\.addListener\('backButton'/.test(nativeBridge) && /Capacitor\.isNativePlatform\(\)/.test(nativeBridge)
  );
  check(
    'معالج الرجوع قبل الموجّه موجود (شاشة الإقلاع/التشغيل الأول)',
    /export function BootBackHandler/.test(backHandlers) && /BootBackHandler/.test(appTsx)
  );
  // مشروع أندرويد مولَّد محلياً (بعد cap sync): يجب أن تكون الإضافات مسجَّلة فعلاً.
  // الملف غير موجود في CI وقت هذا الفحص (يُولَّد في مهمة أندرويد لاحقاً) فلا
  // يجوز أن يفشل الغياب هنا — وجوده يُفحص فقط عندما يكون المشروع مولَّداً.
  const generatedPlugins = await fileText(join(repoRoot, 'android/app/src/main/assets/capacitor.plugins.json'));
  if (generatedPlugins !== null) {
    let plugins = [];
    try {
      plugins = JSON.parse(generatedPlugins);
    } catch {
      plugins = [];
    }
    const registered = new Set(plugins.map((entry) => entry?.classpath ?? ''));
    check(
      'مشروع أندرويد المولَّد يسجّل AppPlugin (زر الرجوع) وليس قائمة فارغة',
      plugins.length > 0 && registered.has('com.capacitorjs.plugins.app.AppPlugin')
    );
    const buildGradle = (await fileText(join(repoRoot, 'android/app/capacitor.build.gradle'))) ?? '';
    check(
      'Gradle يبني إضافة الرجوع داخل الـ APK (:capacitor-app)',
      /implementation project\(':capacitor-app'\)/.test(buildGradle)
    );
  }
  check('سكربت التجهيز يضيف صلاحية الإشعارات', /POST_NOTIFICATIONS/.test(prepareAndroid));
  check('سكربت التجهيز يمنع النص الصريح', /usesCleartextTraffic/.test(prepareAndroid));
  check('سكربت التجهيز يكتب أيقونة الإشعارات', /ic_stat_agri/.test(prepareAndroid));
  check('سكربت التجهيز متكرر بلا تكرار وسوم', /includes\(`android:name="\$\{permission\.name\}"`\)/.test(prepareAndroid));
  check(
    'سكربت التجهيز يزامن app_name بلا تكراره (كان يُفشل MergeResources)',
    /const APP_NAME_TAG =/.test(prepareAndroid) &&
      /match\(APP_NAME_TAG\)/.test(prepareAndroid) &&
      /remaining !== 1/.test(prepareAndroid)
  );
  check(
    'سكربت التجهيز ينسخ أيقونة الإشعارات من أصل المستودع',
    /NOTIFICATION_ICON_SOURCE = 'resources\/android\/ic_stat_agri\.xml'/.test(prepareAndroid)
  );
  const providerPaths = (await fileText(join(repoRoot, 'resources/android/file_paths.xml'))) ?? '';
  check(
    'مزوّد الملفات معلن بسلطة .fileprovider التي يبحث عنها @capacitor/share',
    /androidx\.core\.content\.FileProvider/.test(prepareAndroid) &&
      /FILE_PROVIDER_AUTHORITY = '\$\{applicationId\}\.fileprovider'/.test(prepareAndroid)
  );
  check(
    'سكربت التجهيز ينسخ مسارات المزوّد من أصل المستودع',
    /FILE_PROVIDER_PATHS_SOURCE = 'resources\/android\/file_paths\.xml'/.test(prepareAndroid)
  );
  check(
    'مسارات المزوّد تغطي المستندات والكاش والملفات',
    /<external-path/.test(providerPaths) &&
      /<external-cache-path/.test(providerPaths) &&
      /<cache-path/.test(providerPaths) &&
      /<files-path/.test(providerPaths)
  );
  check(
    'اختبارات سكربت أندرويد تشمل app_name ومزوّد الملفات',
    /ensureFileProvider/.test(prepareAndroidTests) &&
      /syncAppName/.test(prepareAndroidTests) &&
      /prepareAndroid\(\{ root \}\)/.test(prepareAndroidTests)
  );
  check('سكربت التجهيز متاح من package.json', /prepare-android\.mjs/.test(pkg.scripts?.['cap:prepare'] ?? ''));
  const launcherRes = 'resources/android/res';
  const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const launcherFiles = densities.flatMap((density) => [
    `mipmap-${density}/ic_launcher.png`,
    `mipmap-${density}/ic_launcher_round.png`,
    `mipmap-${density}/ic_launcher_foreground.png`,
    `drawable-${density}/splash_logo.png`
  ]);
  const missingLauncher = [];
  for (const file of launcherFiles) {
    if (!(await fileExists(join(repoRoot, launcherRes, file)))) missingLauncher.push(file);
  }
  check(
    `أيقونة التطبيق لكل كثافات أندرويد (قديمة + دائرية + طبقة أمامية + شعار البدء)${missingLauncher.length ? ` — ناقص: ${missingLauncher.join('، ')}` : ''}`,
    missingLauncher.length === 0
  );
  const adaptiveIcon = (await fileText(join(repoRoot, launcherRes, 'mipmap-anydpi-v26/ic_launcher.xml'))) ?? '';
  check(
    'الأيقونة التكيفية بخلفية وطبقة أمامية وطبقة أحادية اللون (أندرويد 13+)',
    /@drawable\/ic_launcher_background/.test(adaptiveIcon) &&
      /@mipmap\/ic_launcher_foreground/.test(adaptiveIcon) &&
      /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/.test(adaptiveIcon) &&
      (await fileExists(join(repoRoot, launcherRes, 'mipmap-anydpi-v26/ic_launcher_round.xml'))) &&
      (await fileExists(join(repoRoot, launcherRes, 'drawable/ic_launcher_monochrome.xml')))
  );
  const splashXml = (await fileText(join(repoRoot, launcherRes, 'drawable/splash.xml'))) ?? '';
  check(
    'شاشة البدء: لون ثابت + شعار في المنتصف (نهاري وليلي) بدل صورة ممطوطة',
    /android:gravity="center"/.test(splashXml) &&
      /@drawable\/splash_logo/.test(splashXml) &&
      (await fileExists(join(repoRoot, launcherRes, 'drawable-night/splash.xml')))
  );
  check(
    'سكربت التجهيز ينسخ أيقونة التطبيق وشاشة البدء ويحذف splash.png القالب (مورد مكرر يُفشل البناء)',
    /LAUNCHER_RES_SOURCE = 'resources\/android\/res'/.test(prepareAndroid) &&
      /TEMPLATE_SPLASH_IMAGE/.test(prepareAndroid) &&
      /installLauncherResources\(/.test(prepareAndroid)
  );
  check('مولّد الأيقونات متاح من package.json (npm run icons)', /generate-icons\.mjs/.test(pkg.scripts?.icons ?? ''));
  check(
    'CI يتحقق من مزوّد الملفات وapp_name داخل الناتج الفعلي',
    /fileprovider|FileProvider/.test(workflow) &&
      /grep -c 'name="app_name"'/.test(workflow) &&
      /resources\/android\/file_paths\.xml/.test(workflow)
  );

  /* ---------------------------- Tauri ---------------------------- */
  section('Tauri (سطح المكتب البديل)');
  check('معرّف التطبيق محدّد', typeof tauri.identifier === 'string' && tauri.identifier.includes('.'));
  check('frontendDist يشير إلى dist', (tauri.build?.frontendDist ?? '').includes('dist'));
  check('CSP محدّد بلا unsafe-eval', Boolean(tauri.app?.security?.csp) && !/unsafe-eval/.test(tauri.app?.security?.csp ?? ''));
  check('النافذة الرئيسية محدّدة', Boolean(tauri.app?.windows?.some((w) => w.label === 'main')));
  check('قيود النافذة (minWidth/minHeight)', (tauri.app?.windows ?? []).every((w) => w.minWidth && w.minHeight));
  const tauriIcons = tauri.bundle?.icon ?? [];
  check('أيقونات Tauri مذكورة', tauriIcons.length > 0);
  for (const icon of tauriIcons.slice(0, 6)) {
    check(`أيقونة Tauri موجودة: ${icon}`, await fileExists(join(repoRoot, 'desktop/src-tauri', icon)));
  }
  check('صلاحية الإشعارات ممنوحة', await fileExists(join(repoRoot, 'desktop/src-tauri/capabilities/default.json')));
  if (await fileExists(join(repoRoot, 'desktop/src-tauri/capabilities/default.json'))) {
    const capabilities = await readJson('desktop/src-tauri/capabilities/default.json');
    check('capability يحتوي notification:default', JSON.stringify(capabilities.permissions ?? []).includes('notification:default'));
  }
  const tauriCargo = await readText('desktop/src-tauri/Cargo.toml');
  const tauriLib = await readText('desktop/src-tauri/src/lib.rs');
  check('نسخة وحيدة من تطبيق Tauri', /single_instance|single-instance/.test(tauriCargo));
  check('إضافة النسخة الوحيدة مسجّلة في lib.rs', /single_instance/.test(tauriLib));
  check('واجهات Tauri العامة متاحة للواجهة المشتركة (withGlobalTauri)', tauri.app?.withGlobalTauri === true);
  check(
    'حفظ الملفات في Tauri بصندوق حفظ أصلي (إضافتا dialog و fs مسجّلتان)',
    /tauri-plugin-dialog/.test(tauriCargo) && /tauri-plugin-fs/.test(tauriCargo) && /tauri_plugin_dialog::init\(\)/.test(tauriLib) && /tauri_plugin_fs::init\(\)/.test(tauriLib)
  );
  check('CSP لا يعتمد على خطوط من الإنترنت (الخط مدمج)', !/fonts\.googleapis|fonts\.gstatic/.test(tauri.app?.security?.csp ?? ''));
  if (await fileExists(join(repoRoot, 'desktop/src-tauri/capabilities/default.json'))) {
    const tauriPermissions = JSON.stringify((await readJson('desktop/src-tauri/capabilities/default.json')).permissions ?? []);
    check(
      'صلاحيات Tauri: صندوق الحفظ + كتابة الملف المختار + إغلاق النافذة بعد تأكيد الخروج',
      ['dialog:allow-save', 'fs:allow-write-file', 'core:window:allow-close'].every((permission) => tauriPermissions.includes(permission))
    );
  }
  const tauriWindowsConfPath = 'desktop/src-tauri/tauri.windows.conf.json';
  if (await fileExists(join(repoRoot, tauriWindowsConfPath))) {
    const tauriWindows = await readJson(tauriWindowsConfPath);
    check('اسم التطبيق على ويندوز (Tauri) عربي مع اسم ملف تنفيذي لاتيني ثابت', /[\u0600-\u06FF]/.test(tauriWindows.productName ?? '') && /^[a-z0-9-]+$/.test(tauriWindows.mainBinaryName ?? ''));
  } else {
    warn('إعداد ويندوز الخاص بـ Tauri (tauri.windows.conf.json) موجود', false);
  }
  const tauriWindowsBundle = tauri.bundle?.windows ?? {};
  check('مثبّت Tauri على ويندوز بالعربية (NSIS + WiX)', (tauriWindowsBundle.nsis?.languages ?? []).includes('Arabic') && tauriWindowsBundle.wix?.language === 'ar-SA');
  // رمز الترقية يُشتق افتراضياً من اسم المنتج؛ تثبيته يجعل تغيير الاسم (إلى العربية)
  // ترقيةً للنسخة المثبّتة لا تطبيقاً مكرراً في قائمة البرامج
  check(
    'رمز ترقية MSI مثبّت (تغيير الاسم لا يكرر التطبيق المثبّت)',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tauriWindowsBundle.wix?.upgradeCode ?? '')
  );

  /* ------------------------ الواجهة المشتركة ------------------------ */
  section('الواجهة المشتركة (كل الأنظمة)');
  check('الخط مدمج داخل التطبيق — لا تحميل خطوط من الإنترنت', !/fonts\.googleapis\.com/.test(indexHtml) && /@fontsource-variable\/cairo/.test(mainTsx));
  check('منع إفلات الملفات من استبدال الواجهة (ويندوز/المتصفح)', /installDropGuard\(\)/.test(mainTsx));
  const viteConfig = await readText('vite.config.ts');
  check(
    'أيقونة الويب: favicon.svg/ico وأيقونة iOS في index.html',
    /href="\/favicon\.svg"/.test(indexHtml) && /href="\/favicon\.ico"/.test(indexHtml) && /rel="apple-touch-icon"/.test(indexHtml)
  );
  check(
    'manifest الـ PWA فيه أيقونة any وأيقونة maskable (أندرويد يقصّها بشكل أيقونات الجهاز)',
    /purpose: 'any'/.test(viteConfig) && /purpose: 'maskable'/.test(viteConfig)
  );
  check('لا حوارات confirm/prompt الأصلية (أزرار إنجليزية وprompt غير مدعوم في ويندوز)', !(await sourceUsesNativeDialogs()));

  /* ------------------------------ CI ------------------------------ */
  section('خط البناء المستمر');
  check('مهمة الجودة تشمل تدقيق الأغلفة', /audit:shells/.test(workflow));
  check('مهمة أندرويد تبنى APK', /assembleRelease/.test(workflow));
  check('مهمة أندرويد تتحقق من الصلاحيات داخل APK', /dump permissions/.test(workflow));
  check('مهمة أندرويد تتحقق من موارد الأيقونة داخل APK', /dump resources/.test(workflow));
  check('مهمة أندرويد تتحقق من مزوّد مشاركة الملفات', /fileprovider/.test(workflow));
  check('مهمة أندرويد تتحقق من أيقونة الإشعارات داخل APK', /ic_stat_agri/.test(workflow));
  check(
    'مهمة أندرويد تتحقق من أيقونة التطبيق وشاشة البدء (مصدراً وداخل APK)',
    /resources\/android\/res/.test(workflow) && /ic_launcher_monochrome/.test(workflow) && /splash_logo/.test(workflow)
  );
  check('مهمة ويندوز تبنى مثبّت + نسخة محمولة', /--win nsis portable/.test(workflow));
  check('مهمة ويندوز تتحقق من محتوى asar', /@electron\/asar list/.test(workflow));
  check('اختبار دخان إلكترون يعمل فعلياً', /electron \. --smoke-test/.test(workflow));
  check('مهمة Tauri تبنى حزم أصلية (deb/AppImage على لينكس)', /--bundles deb,appimage/.test(workflow));
  check('مهمة Tauri تبنى حزم أصلية (msi/nsis على ويندوز)', /--bundles msi,nsis/.test(workflow));
  check(
    'مهمة أندرويد تتحقق من تسجيل الإضافات الأصلية بعد cap sync (AppPlugin لزر الرجوع)',
    /capacitor\.plugins\.json/.test(workflow) && /com\.capacitorjs\.plugins\.app\.AppPlugin/.test(workflow)
  );
  check(
    'مهمة أندرويد تتحقق من وجود AppPlugin داخل الـ APK المبني',
    /capacitor\.plugins\.json/.test(workflow) && /AppPlugin/.test(workflow)
  );
  check('مهمة ويندوز تشغّل النسخة المحمولة فعلياً (اختبار دخان)', /OfficeManager-Portable-\*\.exe/.test(workflow) && /--smoke-test/.test(workflow));
  check('مهمة ويندوز تثبّت المثبّت صامتاً وتتحقق من التثبيت', /Uninstall\*\.exe|\/S'/.test(workflow));
  check('تدقيق أمني للاعتماديات', /npm audit --audit-level=high/.test(workflow));

  /* -------------------------- نواتج البناء -------------------------- */
  section('ناتج الويب (إن كان مبنياً)');
  const distIndex = join(repoRoot, 'dist/index.html');
  if (existsSync(distIndex)) {
    const html = await readText('dist/index.html');
    check('لا مسارات مطلقة للأصول (تعمل تحت file://)', !/(src|href)="\/assets/.test(html));
    check('يوجد عنصر جذر #root', /id="root"/.test(html));
    const stats = await stat(join(repoRoot, 'dist/sw.js')).catch(() => null);
    warn('عامل الخدمة مُنتَج (PWA)', Boolean(stats));
  } else {
    warn('لم يُبنَ dist بعد — نفّذ npm run build قبل فحص الناتج', false);
  }

  console.log(`\nنتيجة التدقيق: ${checks - failures - warnings} ناجح، ${warnings} تحذير، ${failures} فشل (المجموع ${checks})`);
  if (failures > 0) {
    console.error('✖ فشل تدقيق الأغلفة');
    process.exit(1);
  }
  console.log('✔ تدقيق الأغلفة ناجح');
}

/** هل تستخدم شيفرة الواجهة confirm()/prompt()/alert() الأصلية؟ */
async function sourceUsesNativeDialogs() {
  let found = false;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      // استدعاء فعلي (لا ذكر داخل تعليق): بداية سطر/مسافة ثم الاسم ثم (
      if (/(^|[\s(!=&|?:,;])(window\.)?(confirm|prompt|alert)\(/m.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))) found = true;
    }
  };
  await walk(join(repoRoot, 'src'));
  return found;
}

/** قراءة ملف نصي أو null إذا لم يوجد. */
async function fileText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('✖ خطأ غير متوقع في تدقيق الأغلفة:', error);
  process.exit(1);
});
