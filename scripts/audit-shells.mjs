#!/usr/bin/env node
/**
 * تدقيق أغلفة التشغيل (أندرويد/ويندوز/تيوري) قبل أي بناء.
 *
 * الهدف: منع تسليم نسخة "تُبنى بنجاح" لكنها معطوبة على الجهاز:
 *   - APK بلا صلاحية إشعارات ⇒ لا إشعارات أبداً.
 *   - APK يمنع النص الصريح لكنه يشير لأيقونة غير موجودة ⇒ شريط حالة أبيض.
 *   - NSIS/portable بإعداد ناقص ⇒ بيانات تُمسح عند كل تشغيل (نسخة محمولة).
 *   - Tauri ناقص المعرّف/الأيقونات/الصلاحيات ⇒ فشل بناء أو تطبيق بلا إشعارات.
 *   - واجهة مبنية بمسارات مطلقة ⇒ شاشة بيضاء تحت file:// داخل الأغلفة.
 *
 * هذا فحص ثابت (لا يحتاج JDK/SDK/Wine) لذلك يعمل في أي بيئة، بينما الفحوص
 * الديناميكية (تحليل APK، تشغيل المثبّت، بناء Tauri) تتم في CI على النواتج
 * الفعلية.
 */

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
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

async function main() {
  const pkg = await readJson('package.json');
  const capacitor = await readJson('capacitor.config.json');
  const builder = await readJson('electron-builder.json');
  const tauri = await readJson('desktop/src-tauri/tauri.conf.json');
  const mainCjs = await readText('electron/main.cjs');
  const preloadCjs = await readText('electron/preload.cjs');
  const prepareAndroid = await readText('scripts/prepare-android.mjs');
  const appTsx = await readText('src/App.tsx');
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
  check('صفحة الخطأ العربية لتعذّر التحميل موجودة', /تعذّر تحميل واجهة التطبيق/.test(mainCjs));

  /* --------------------------- أندرويد --------------------------- */
  section('أندرويد (Capacitor)');
  check('appId صحيح', capacitor.appId === 'com.agrioffice.debtregister');
  check('webDir = dist', capacitor.webDir === 'dist');
  check('androidScheme = https', capacitor.server?.androidScheme === 'https');
  check('allowMixedContent معطّل', capacitor.android?.allowMixedContent === false);
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
  check('سكربت التجهيز متاح من package.json', /prepare-android\.mjs/.test(pkg.scripts?.['cap:prepare'] ?? ''));

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
  check('نسخة وحيدة من تطبيق Tauri', /single_instance|single-instance/.test(await readText('desktop/src-tauri/Cargo.toml')));
  check('إضافة النسخة الوحيدة مسجّلة في lib.rs', /single_instance/.test(await readText('desktop/src-tauri/src/lib.rs')));

  /* ------------------------------ CI ------------------------------ */
  section('خط البناء المستمر');
  check('مهمة الجودة تشمل تدقيق الأغلفة', /audit:shells/.test(workflow));
  check('مهمة أندرويد تبنى APK', /assembleRelease/.test(workflow));
  check('مهمة أندرويد تتحقق من الصلاحيات داخل APK', /dump permissions/.test(workflow));
  check('مهمة أندرويد تتحقق من موارد الأيقونة داخل APK', /dump resources/.test(workflow));
  check('مهمة أندرويد تتحقق من مزوّد مشاركة الملفات', /fileprovider/.test(workflow));
  check('مهمة أندرويد تتحقق من أيقونة الإشعارات داخل APK', /ic_stat_agri/.test(workflow));
  check('مهمة ويندوز تبنى مثبّت + نسخة محمولة', /--win nsis portable/.test(workflow));
  check('مهمة ويندوز تتحقق من محتوى asar', /@electron\/asar list/.test(workflow));
  check('اختبار دخان إلكترون يعمل فعلياً', /electron \. --smoke-test/.test(workflow));
  check('مهمة Tauri تبنى حزم أصلية (deb/AppImage على لينكس)', /--bundles deb,appimage/.test(workflow));
  check('مهمة Tauri تبنى حزم أصلية (msi/nsis على ويندوز)', /--bundles msi,nsis/.test(workflow));
  check('مهمة ويندوز تشغّل النسخة المحمولة فعلياً (اختبار دخان)', /AgriOffice-Portable-\*\.exe/.test(workflow) && /--smoke-test/.test(workflow));
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
