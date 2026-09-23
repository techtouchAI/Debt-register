#!/usr/bin/env node
/**
 * تدقيق أغلفة التشغيل (Android / Windows-Electron / Tauri) بشكل آلي.
 *
 * سبب وجود هذا السكربت: متطلبات أغلفة التشغيل (الصلاحيات، الأذونات، الروابط
 * الخارجية، حفظ الملفات، منع النوافذ المتعددة، مسار بيانات النسخة المحمولة)
 * كانت تُفحص يدوياً على أجهزة حقيقية، فيسقط بعضها من الإصدارات اللاحقة بلا
 * أن يلاحظه أحد. هنا تُحوَّل تلك المتطلبات إلى فحوص قابلة للتشغيل في كل
 * commit وفي CI، وما يبقى يدوياً فقط هو التشغيل الفعلي على الجهاز (موثّق في
 * docs/QA-CHECKLIST.md).
 *
 * الاستخدام: `npm run audit:shells`
 */

import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  checks.push({ name, ok, detail });
}

async function read(path) {
  return readFile(join(root, path), 'utf8');
}

async function readJson(path) {
  return JSON.parse(await read(path));
}

async function exists(path) {
  try {
    await access(join(root, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** فحص نصي: كل النصوص المطلوبة موجودة في الملف. */
function checkContainsAll(label, text, needles) {
  const missing = needles.filter((needle) => !text.includes(needle));
  check(label, missing.length === 0, missing.length ? `ناقص: ${missing.join(' ، ')}` : '');
}

async function auditElectron() {
  const main = await read('electron/main.cjs');
  const preload = await read('electron/preload.cjs');
  const config = await readJson('electron-builder.json');

  checkContainsAll('Electron: أمان النافذة', main, [
    'contextIsolation: true',
    'nodeIntegration: false',
    'sandbox: true',
    'webSecurity: true',
    'allowRunningInsecureContent: false'
  ]);
  checkContainsAll('Electron: منع التنقل الخارجي وفتح الروابط في المتصفح', main, [
    'setWindowOpenHandler',
    'will-navigate',
    'shell.openExternal',
    'will-attach-webview'
  ]);
  checkContainsAll('Electron: نسخة وحيدة + أذونات صريحة', main, [
    'requestSingleInstanceLock',
    'setPermissionRequestHandler',
    'setPermissionCheckHandler'
  ]);
  checkContainsAll('Electron: حفظ بيانات النسخة المحمولة', main, [
    'PORTABLE_EXECUTABLE_DIR',
    "app.setPath('userData'"
  ]);
  checkContainsAll('Electron: كتابة ذرّية ومنع اجتياز المسار', main, ['.tmp', 'safeFileName']);
  checkContainsAll('Electron: جسر آمن محدود', preload, [
    'contextBridge.exposeInMainWorld',
    "ipcRenderer.invoke('save-file'",
    "ipcRenderer.invoke('save-backup'",
    "ipcRenderer.invoke('show-notification'"
  ]);
  check('Electron: لا يُعرّض ipcRenderer للواجهة', !/exposeInMainWorld\([^)]*ipcRenderer\s*[,}]/.test(preload));

  const targets = (config?.win?.target ?? []).map((target) =>
    typeof target === 'string' ? target : target.target
  );
  check('حزمة Windows: مُثبِّت nsis + نسخة محمولة', targets.includes('nsis') && targets.includes('portable'), targets.join(','));
  check('حزمة Windows: اسم ملف المثبّت واضح', Boolean(config?.nsis?.artifactName));
  check('حزمة Windows: اسم النسخة المحمولة', Boolean(config?.portable?.artifactName));
  check('حزمة Windows: asar مفعّل', config?.asar === true);
  check(
    'حزمة Windows: ملفات البناء محددة',
    (config?.files ?? []).some((pattern) => String(pattern).startsWith('dist/')) &&
      (config?.files ?? []).some((pattern) => String(pattern).startsWith('electron/'))
  );
  check('حزمة Windows: مجلد الإخراج', config?.directories?.output === 'release');
  check('حزمة Windows: عدم حذف بيانات المستخدم عند إلغاء التثبيت', config?.nsis?.deleteAppDataOnUninstall === false);
}

async function auditAndroid() {
  const config = await readJson('capacitor.config.json');
  check('أندرويد: معرّف التطبيق', config?.appId === 'com.agrioffice.debtregister', String(config?.appId));
  check('أندرويد: مجلد بناء الويب', config?.webDir === 'dist', String(config?.webDir));
  check('أندرويد: مخطط https فقط', config?.server?.androidScheme === 'https');
  check('أندرويد: منع المحتوى المختلط', config?.android?.allowMixedContent === false);
  check('أندرويد: تصحيح WebView معطّل في الإنتاج', config?.android?.webContentsDebuggingEnabled === false);
  check('أندرويد: طلب صلاحيات الملفات', config?.plugins?.Filesystem?.androidRequestPermissions === true);

  const iconName = config?.plugins?.LocalNotifications?.smallIcon;
  check('أندرويد: اسم أيقونة الإشعارات مطابق للمورَد', iconName === 'ic_stat_agri', String(iconName));
  check('أندرويد: مورَد أيقونة الإشعارات موجود', await exists('resources/android/ic_stat_agri.xml'));
  check('أندرويد: لا صوت إشعار يشير إلى مورد غير موجود', config?.plugins?.LocalNotifications?.sound === undefined);

  const prepare = await read('scripts/prepare-android.mjs');
  checkContainsAll('أندرويد: سكربت التجهيز يُعلن الصلاحيات', prepare, [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'maxSdkVersion',
    'usesCleartextTraffic'
  ]);
  check('أندرويد: سكربت التجهيز قابل للتشغيل المتكرر', prep_isIdempotent(prepare));
  check('أندرويد: سكربت التجهيز مولَّد أيقونات التطبيق', prepare.includes('ic_launcher.png'));
}

function prep_isIdempotent(prepareSource) {
  // يعيد كتابة الوسوم بدل إضافتها بشكل تراكمي
  return /normalizePermissionTags|replace\(/.test(prepareSource);
}

async function auditTauri() {
  const config = await readJson('desktop/src-tauri/tauri.conf.json');
  const capabilities = await readJson('desktop/src-tauri/capabilities/default.json');
  const cargo = await read('desktop/src-tauri/Cargo.toml');
  const lib = await read('desktop/src-tauri/src/lib.rs');

  check('Tauri: المعرّف', config?.identifier === 'ai.techtouch.agrooffice', String(config?.identifier));
  check('Tauri: مجلد الواجهة المبنيّة', config?.build?.frontendDist === './dist', String(config?.build?.frontendDist));
  const csp = config?.app?.security?.csp ?? '';
  check('Tauri: سياسة CSP محدَّدة', typeof csp === 'string' && csp.includes("default-src 'self'"));
  check('Tauri: بلا unsafe-eval في CSP', !csp.includes('unsafe-eval'));
  check('Tauri: نافذة بحد أدنى معقول', config?.app?.windows?.[0]?.minWidth >= 800);
  check('Tauri: صلاحية الإشعارات', (capabilities?.permissions ?? []).includes('notification:default'));
  check('Tauri: إضافة الإشعارات في Rust', lib.includes('tauri_plugin_notification::init'));
  check('Tauri: منع تشغيل نسختين (قفل النسخة الوحيدة)', cargo.includes('single-instance') && lib.includes('single_instance'));
  check('Tauri: نقل موارِد البناء إلى مجلد الواجهة', await exists('desktop/scripts/copy-assets.mjs'));

  const icons = config?.bundle?.icon ?? [];
  check('Tauri: أيقونات الحزمة موجودة', icons.length > 0);
  for (const icon of icons) {
    // eslint-disable-next-line no-await-in-loop
    check(`Tauri: وجود الأيقونة ${icon}`, await exists(join('desktop/src-tauri', icon)));
  }
}

async function auditCi() {
  const ci = await read('.github/workflows/build.yml');
  checkContainsAll('CI: يوظّف تجهيز أندرويد', ci, ['prepare-android', 'cap sync']);
  checkContainsAll('CI: يتحقق من صلاحيات APK المبني', ci, ['aapt2', 'POST_NOTIFICATIONS']);
  checkContainsAll('CI: يبني مثبّت ويندوز', ci, ['electron-builder', 'nsis']);
  checkContainsAll('CI: يبني Tauri', ci, ['tauri']);
  check('CI: تدقيق الأغلفة جزء من التحقق', ci.includes('audit:shells'));
}

async function main() {
  await auditElectron();
  await auditAndroid();
  await auditTauri();
  await auditCi();

  const width = Math.max(...checks.map((entry) => entry.name.length));
  console.log('تدقيق أغلفة التشغيل (Android / Windows / Tauri)\n');
  for (const entry of checks) {
    const mark = entry.ok ? '✅' : '❌';
    const detail = entry.detail ? ` — ${entry.detail}` : '';
    console.log(`${mark} ${entry.name.padEnd(width)}${detail}`);
  }
  console.log(`\n${checks.length - failures}/${checks.length} فحصاً ناجحاً`);
  if (failures > 0) {
    console.error(`\n❌ فشل ${failures} فحصاً — أصلح الأغلفة قبل البناء.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('فشل تدقيق الأغلفة:', error);
  process.exit(1);
});
