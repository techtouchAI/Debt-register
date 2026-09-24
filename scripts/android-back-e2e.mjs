/**
 * اختبار حقيقي (متصفح فعلي) لمسار زر الرجوع على أندرويد مقابل حزمة `dist` المبنية.
 *
 * لماذا؟ الاختبارات الوحدية تعمل في jsdom وتستبدل الجسر الأصلي، فلا تلمس
 * تسلسل Capacitor الحقيقي. هذا الملف يشغّل الحزمة نفسها التي تُنسخ إلى الـ APK
 * داخل متصفح فعلي، ويحاكي الطبقة الأصلية بنفس عقود `native-bridge.js` و
 * منطق `AppPlugin.handleOnBackPressed` في Capacitor 8 (مثبَّت في المستودع).
 *
 * التشغيل (يتطلب playwright-core قابلة للحل + متصفح chromium خارجي):
 *   npm i --no-save playwright-core
 *   DIST=/path/to/dist CHROMIUM=/path/to/chrome node scripts/android-back-e2e.mjs
 */
/**
 * تحقّق حقيقي (متصفح فعلي) من مسار زر الرجوع في أندرويد داخل حزمة `dist` المبنية.
 *
 * نحاكي طبقة Capacitor الأصلية بدقة مطابقة لشفرة Capacitor 8 المثبَّتة:
 *   AppPlugin.handleOnBackPressed() (OnBackPressedCallback):
 *     - إن وُجد مستمع JS واحد على الأقل: notifyListeners('backButton', {canGoBack}) ⇒ لا إنهاء.
 *     - وإلا: إن أمكن الرجوع في سجل WebView ⇒ goBack().
 *     - وإلا: لا شيء... لكن إن لم تكن الإضافة مسجَّلة أصلاً فلا يوجد Callback
 *       إطلاقاً ⇒ ينفّذ النظام الإنهاء الافتراضي (finish) = خروج التطبيق.
 *   ولهذا نُشغّل الوضعين: إضافة مسجَّلة (بعد الإصلاح) وغير مسجَّلة (الحزمة المعطوبة).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST ?? path.join(HERE, '..', 'dist');
const EXECUTABLE = process.env.CHROMIUM ?? '/tmp/chromium';

/* ------------------------------- سيرفر ثابت ------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ------------------------- محاكاة الطبقة الأصلية ------------------------- */
function installNativeAndroidShim({ appPluginRegistered }) {
  // محاكاة `native-bridge.js` (نسخة أندرويد) + `AppPlugin.java` معاً، بنفس عقود
  // الاستدعاء الحقيقية: nativeCallback تُعيد معرّف ردّ نداء (نص)، nativePromise
  // تُعيد وعداً، removeListener تُلغي المستمع فعلاً بمعرّفه.
  const state = { listeners: [], exitCalls: 0, finished: false, log: [] };
  window.__native = state;
  window.androidBridge = { postMessage: () => {} }; // ⇒ getPlatformId = 'android'

  let callbackIdCount = 1000;
  const listeners = new Map(); // callbackId -> { eventName, callback }
  const retained = new Map(); // eventName -> [data]

  const deliver = (entry, data) => {
    state.log.push(`notifyListeners App.${entry.eventName}`);
    entry.callback(data);
  };

  const appMethods = [
    { name: 'addListener', rtype: 'callback' },
    { name: 'removeListener', rtype: 'callback' },
    { name: 'removeAllListeners', rtype: 'promise' },
    { name: 'getInfo', rtype: 'promise' },
    { name: 'getState', rtype: 'promise' },
    { name: 'getLaunchUrl', rtype: 'promise' },
    { name: 'minimizeApp', rtype: 'promise' },
    { name: 'toggleBackButtonHandler', rtype: 'promise' },
    { name: 'exitApp', rtype: 'promise' }
  ];

  window.Capacitor = {
    // PluginHeaders تأتي من capacitor.plugins.json: فارغة في الحزمة المعطوبة
    PluginHeaders: appPluginRegistered ? [{ name: 'App', methods: appMethods }] : [],
    nativeCallback: (plugin, method, options, callback) => {
      const callbackId = String(++callbackIdCount);
      state.log.push(`nativeCallback ${plugin}.${method} ${JSON.stringify(options ?? {})}`);
      if (plugin === 'App' && method === 'addListener') {
        const entry = { eventName: options?.eventName, callback };
        listeners.set(callbackId, entry);
        state.listeners = [...listeners.entries()].map(([id, e]) => ({ id, eventName: e.eventName }));
        // نفس سلوك Plugin.addEventListener: يُرسَل الحدث المحتفَظ به للمستمع الجديد
        const pending = retained.get(entry.eventName);
        if (pending && pending.length > 0) {
          retained.delete(entry.eventName);
          for (const data of pending) deliver(entry, data);
        }
      }
      if (plugin === 'App' && method === 'removeListener' && options?.callbackId) {
        listeners.delete(String(options.callbackId));
        state.listeners = [...listeners.entries()].map(([id, e]) => ({ id, eventName: e.eventName }));
      }
      if (plugin === 'App' && method === 'exitApp') {
        state.exitCalls += 1;
        state.finished = true;
      }
      return callbackId;
    },
    nativePromise: (plugin, method, options) => {
      state.log.push(`nativePromise ${plugin}.${method} ${JSON.stringify(options ?? {})}`);
      if (plugin === 'App' && method === 'removeListener' && options?.callbackId) {
        listeners.delete(String(options.callbackId));
        state.listeners = [...listeners.entries()].map(([id, e]) => ({ id, eventName: e.eventName }));
      }
      if (plugin === 'App' && method === 'exitApp') {
        state.exitCalls += 1;
        state.finished = true;
      }
      return Promise.resolve({});
    }
  };

  /**
   * ضغطة زر الرجوع، بمنطق الطبقة الأصلية:
   *  - بلا AppPlugin مسجَّل: لا OnBackPressedCallback إطلاقاً ⇒ النظام يُنهي النشاط (finish).
   *  - مع AppPlugin: OnBackPressedCallback مفعّل ⇒ إن وُجد مستمع JS يُسلَّم له الحدث
   *    (ولا إنهاء)، وإلا فالرجوع في سجل WebView إن أمكن.
   */
  window.__pressAndroidBack = () => {
    if (!appPluginRegistered) {
      state.finished = true;
      state.exitCalls += 1;
      return 'activity.finish';
    }
    const canGoBack = window.history.length > 1; // webView.canGoBack()
    if (listeners.size > 0) {
      for (const entry of [...listeners.values()]) deliver(entry, { canGoBack });
      return `js:${listeners.size}`;
    }
    if (canGoBack) {
      window.history.back();
      return 'webview-goBack';
    }
    // لا مستمع: الحدث يُحتفَظ به (retainUntilConsumed) ولا إنهاء
    const list = retained.get('backButton') ?? [];
    list.push({ canGoBack });
    retained.set('backButton', list);
    return 'retained';
  };
}

/* --------------------------------- أدوات --------------------------------- */
const results = [];
function check(name, ok, extra = '') {
  results.push({ ok, name, extra });
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // أول تشغيل: معالج الإعداد
  await page.waitForSelector('#setup-officeName', { timeout: 20000 });
  return page;
}

async function completeSetup(page, officeName) {
  await page.fill('#setup-officeName', officeName);
  await page.fill('#setup-phone', '07801234567');
  await page.fill('#setup-address', 'شارع المكتب - بناية رقم 1');
  await page.getByRole('button', { name: /حفظ وبدء استخدام النظام/ }).first().click();
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 20000 });
}

const hash = (page) => page.evaluate(() => location.hash);
const native = (page) => page.evaluate(() => window.__native);
const pressBack = (page) => page.evaluate(() => window.__pressAndroidBack());
// على عرض الهاتف تكون القائمة الجانبية دُرجاً مخفياً؛ التنقّل بالمسار نفسه
// الذي تستخدمه الروابط (HashRouter ⇒ تغيير الـ hash = ضغطة رابط بالضبط).
const go = async (page, route) => {
  await page.evaluate((r) => {
    window.location.hash = r;
  }, route);
  await sleep(350);
};

/* ------------------------------ التشغيل ------------------------------ */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
console.log(`حزمة الويب: ${DIST}`);
console.log(`المتصفح: ${await browser.version()}\n`);

/* ============ 1) الحزمة الصحيحة: إضافة الرجوع مسجَّلة (بعد الإصلاح) ============ */
console.log('— السيناريو أ: AppPlugin مسجَّل (بعد الإصلاح) —');
const fixedContext = await browser.newContext({ viewport: { width: 430, height: 920 } });
await fixedContext.addInitScript(installNativeAndroidShim, { appPluginRegistered: true });
const page = await boot(fixedContext);
check('شاشة التشغيل الأول تظهر ويكتمل الإعداد', true);
await completeSetup(page, 'مكتب الاختبار');
check('بعد الإعداد: المسار الرئيسي', (await hash(page)) === '#/' || (await hash(page)) === '', await hash(page));

const afterBoot = await native(page);
check(
  'المستمع الأصلي مُسجَّل منذ الإقلاع (لا لحظة بلا مستمع ⇒ لا إنهاء تلقائي)',
  afterBoot.listeners.length >= 1,
  `${afterBoot.listeners.length} مستمع`
);

await go(page, '#/invoices');
check('تنقّل: قائمة الفواتير', (await hash(page)) === '#/invoices', await hash(page));

await page.getByText('فاتورة بيع جديدة').first().click();
await sleep(400);
check('تنقّل: نموذج فاتورة جديدة (أعمق مستوى)', (await hash(page)) === '#/invoices/new', await hash(page));

// الطبقة العلوية: حوار إضافة مادة سريعة فوق نموذج الفاتورة
const materialSearch = page.locator('input[placeholder^="ابحث باسم المادة"]').first();
await materialSearch.click();
await materialSearch.pressSequentially('مادة اختبار الرجوع', { delay: 25 });
await page.getByText(/كمادة جديدة/).first().click();
await page.waitForSelector('[role="dialog"][aria-label="إضافة مادة جديدة"]', { timeout: 10000 });
check('فُتحت طبقة (حوار) فوق الصفحة', true);

let before = await native(page);
check('ضغطة الرجوع تُسلَّم إلى JS لا للنظام', (await pressBack(page)) !== 'activity.finish');
await sleep(500);
let after = await native(page);
check(
  'الرجوع يغلق الطبقة المفتوحة أولاً (ولا يخرج من الشاشة)',
  !(await page.locator('[role="dialog"][aria-label="إضافة مادة جديدة"]').isVisible().catch(() => false)) &&
    (await hash(page)) === '#/invoices/new',
  `hash=${await hash(page)}`
);
check('لم يُطلب أي خروج', after.exitCalls === before.exitCalls, `exitCalls=${after.exitCalls}`);

await pressBack(page);
await sleep(600);
check('الرجوع التالي يرجع شاشة واحدة (نموذج ⇒ القائمة)', (await hash(page)) === '#/invoices', await hash(page));

await pressBack(page);
await sleep(600);
check('الرجوع مرة أخرى ⇒ الرئيسية', (await hash(page)) === '#/' || (await hash(page)) === '', await hash(page));

before = await native(page);
await pressBack(page);
await sleep(600);
check('عند الجذر: حوار تأكيد الخروج بدل الإنهاء الفوري', await page.getByText('الخروج من التطبيق؟').isVisible());
after = await native(page);
check('لم يُنفَّذ أي إنهاء قبل تأكيد المستخدم', after.exitCalls === before.exitCalls, `exitCalls=${after.exitCalls}`);

await page.getByRole('button', { name: 'إغلاق التطبيق' }).click();
await sleep(600);
after = await native(page);
check('الإنهاء يحدث فقط بعد التأكيد الصريح (App.exitApp)', after.exitCalls === before.exitCalls + 1, `exitCalls=${after.exitCalls}`);
await fixedContext.close();

/* ============ 2) الحزمة المعطوبة: لا إضافة مسجَّلة (قبل الإصلاح) ============ */
console.log('\n— السيناريو ب: لا AppPlugin (الحالة المعطوبة قبل الإصلاح) —');
const brokenContext = await browser.newContext({ viewport: { width: 430, height: 920 } });
await brokenContext.addInitScript(installNativeAndroidShim, { appPluginRegistered: false });
const broken = await boot(brokenContext);
await completeSetup(broken, 'مكتب الاختبار');
await go(broken, '#/invoices');
const brokenBefore = await native(broken);
check('لا مستمع JS على حدث backButton (الإضافة غير موجودة)', brokenBefore.listeners.length === 0);

await pressBack(broken);
await sleep(500);
const brokenAfter = await native(broken);
check(
  'يعيد إنتاج العطل المُبلَّغ عنه: الضغطة تُنهي التطبيق فوراً بدل الرجوع',
  brokenAfter.finished === true && (await hash(broken)) === '#/invoices',
  `finished=${brokenAfter.finished} hash=${await hash(broken)}`
);
await brokenContext.close();

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nالنتيجة: ${results.length - failed.length} ناجح، ${failed.length} فشل`);
process.exit(failed.length === 0 ? 0 : 1);
