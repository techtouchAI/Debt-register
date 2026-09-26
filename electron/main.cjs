const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { isSameFilePathname } = require('./ipcGuard.cjs');
const { resolveUserDataDir } = require('./userData.cjs');
const { safeFileName, writeFileAtomically, runFilesystemSmoke } = require('./files.cjs');
const { classifyPrintCallback } = require('./printResult.cjs');

/**
 * نافذة سطح المكتب لنظام إدارة المكتب.
 *
 * مبادئ الأمان المطبّقة هنا:
 *  - contextIsolation مفعّل و nodeIntegration معطّل و sandbox مفعّل.
 *  - منع تنقّل النافذة إلى أي مصدر خارج التطبيق (كان أي رابط خارجي يفتح
 *    داخل النافذة فيترك المستخدم أمام صفحة بيضاء/تطبيق معطّل).
 *  - الروابط الخارجية تُفتح في المتصفح الافتراضي فقط.
 *  - نسخة وحيدة من التطبيق حتى لا تكتب نافذتان على نفس قاعدة البيانات.
 */

/**
 * أيقونة النافذة (شريط العنوان وشريط المهام): على ويندوز ملف ICO متعدد المقاسات —
 * فيه نسخة مبسّطة واضحة لأحجام 16–32 بكسل — بدل تصغير PNG واحد فيصير ضبابياً.
 * أيقونة الإشعار PNG لأن إشعارات ويندوز لا تعرض ملفات ICO.
 */
const WINDOW_ICON = path.join(
  __dirname,
  process.platform === 'win32' ? '../resources/icon/app.ico' : '../public/pwa-192x192.png'
);
const NOTIFICATION_ICON = path.join(__dirname, '../public/pwa-192x192.png');
const APP_INDEX = path.join(__dirname, '../dist/index.html');
/** اسم مجلد التطبيق المقترح داخل "التنزيلات" (مطابق لأندرويد: المستندات/إدارة المكتب). */
const APP_FOLDER = 'إدارة المكتب';
let mainWindow = null;

/* ----------------------------- لغة الواجهة ----------------------------- */
/**
 * لغة Chromium الداخلية عربية مهما كانت لغة ويندوز: رسائل التحقق في الحقول،
 * منتقي التاريخ، وقوائم النظام الافتراضية — فلا تظهر أي عبارة إنجليزية.
 * يجب ضبطها قبل جاهزية التطبيق (قبل `app.whenReady`).
 */
app.commandLine.appendSwitch('lang', 'ar');

/**
 * وضع اختبار الدخان (Smoke test) للتشغيل في CI:
 *   xvfb-run -a npx electron . --smoke-test
 * يفتح النافذة فعلياً، يتأكد من تحميل الواجهة ومن أن جسر preload (electronAPI)
 * متاح، ثم يخرج بالرمز 0. أي فشل (واجهة فارغة، خطأ تحميل، جسر مفقود) = رمز 1.
 * هذا يمنع أن يُسلَّم مُثبِّت لا يفتح أصلاً.
 */
const SMOKE_TEST = process.argv.includes('--smoke-test');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

/* ------------------------- بيانات المستخدم (userData) ------------------------- */
/**
 * مجلد بيانات المستخدم (فيه IndexedDB أي الفواتير والديون).
 *
 * 1) النسخة المحمولة (`portable`): المجلد الافتراضي داخل مسار مؤقت يُمسح عند
 *    الخروج، فتُفقد البيانات مع كل تشغيل — لذلك نوجّهها إلى مجلد ثابت بجانب
 *    الملف التنفيذي. يترك electron-builder هذا المتغيّر في النسخة المحمولة.
 *
 * 2) النسخة المثبّتة: مجلد ثابت `debt-register-office` لا يتبع اسم العرض.
 *    إن وُجدت قاعدة أقدم (اسم عربي أو مسار محمولة مسجّل) تُنسخ مرة واحدة
 *    إلى المجلد الفارغ فقط، ولا يُحذف الأصل.
 */
function configureUserDataDir() {
  try {
    const appDataDir = app.getPath('appData');
    const dataDir = resolveUserDataDir({
      appDataDir,
      portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
      // المسار الافتراضي الحالي قبل تثبيت المجلد الثابت، حتى لا تُفقد قاعدة
      // كانت في اسم العرض العربي أو أي اسم اشتقه Electron.
      extraCandidates: [app.getPath('userData')],
      warn: (error) => console.error('تعذّر نقل قاعدة البيانات:', error)
    });
    app.setPath('userData', dataDir);
    app.setPath('sessionData', dataDir);
  } catch (error) {
    console.error('تعذّر تجهيز مجلد بيانات المستخدم:', error);
  }
}

configureUserDataDir();

// معرّف التطبيق على ويندوز: يلزم لظهور الإشعارات باسم التطبيق الصحيح
// ولتثبيت التطبيق في قائمة ابدأ بشكل متسق.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agrioffice.debtregister');
}

/**
 * هل الرابط هو صفحة التطبيق نفسها؟
 * سابقاً كان أي رابط file:// مسموحاً، فإفلات ملف (نسخة احتياطية مثلاً) فوق
 * النافذة يستبدل التطبيق بمحتوى الملف. الآن: صفحة التطبيق فقط (بأي مسار #).
 */
function isInternalUrl(target) {
  try {
    const url = new URL(target);
    // خادم التطوير ثابت ومعلوم؛ لا يكفي قبول أي خدمة تعمل محلياً.
    if (isDev) return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '5173';
    if (url.protocol !== 'file:') return false;
    return isSameFilePathname(url.pathname, pathToFileURL(APP_INDEX).pathname);
  } catch {
    return false;
  }
}

/**
 * تحقّق دفاعي لكل قناة IPC ذات صلاحية على نظام ويندوز.
 *
 * عزل السياق وجسر preload المحدود هما خط الدفاع الأول، لكن لا يجوز افتراض
 * أن كل إطار renderer موثوق: لا يُقبل طلب حفظ/طباعة/إشعار إلا من صفحة
 * التطبيق الفعلية (ملف الإنتاج أو خادم Vite المعروف في التطوير). يقي ذلك
 * العملية الرئيسية ذات صلاحية القرص من أي تنقّل أو إطار غير متوقّع مستقبلاً.
 */
function isTrustedIpcSender(event) {
  return isInternalUrl(event?.senderFrame?.url || '');
}

function rejectUntrustedIpc(event, channel) {
  if (isTrustedIpcSender(event)) return false;
  console.warn(`رفض طلب IPC غير موثوق: ${channel}`);
  return true;
}

/* ------------------------------ حالة النافذة ------------------------------ */
/**
 * مستوى التكبير يُحفظ بين مرات التشغيل (Ctrl + عجلة الفأرة، Ctrl و + / - / 0)
 * — تفصيل مهم على شاشات ويندوز الصغيرة أو الكبيرة جداً.
 */
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 4;

function readWindowState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeWindowState(patch) {
  try {
    const next = { ...readWindowState(), ...patch };
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(next));
  } catch (error) {
    console.warn('تعذّر حفظ حالة النافذة:', error);
  }
}

function applyZoom(contents, level) {
  const clamped = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(level * 2) / 2));
  contents.setZoomLevel(clamped);
  writeWindowState({ zoomLevel: clamped });
}

/* ------------------------- قائمة الزر الأيمن (عربية) ------------------------- */
/**
 * Electron لا يعرض أي قائمة عند النقر بالزر الأيمن، ومستخدم ويندوز يتوقع
 * "قص/نسخ/لصق" في الحقول. القائمة هنا عربية بالكامل وتظهر فقط حيث تفيد:
 * في حقول الكتابة، أو عند تحديد نص. (بلا عناصر تقنية مثل "فحص العنصر").
 */
function buildContextMenu(contents, params) {
  const { editFlags, isEditable, selectionText } = params;
  const hasSelection = Boolean(selectionText && selectionText.trim());
  const template = [];
  if (isEditable) {
    template.push(
      { label: 'تراجع', enabled: editFlags.canUndo, click: () => contents.undo() },
      { label: 'إعادة', enabled: editFlags.canRedo, click: () => contents.redo() },
      { type: 'separator' },
      { label: 'قص', enabled: editFlags.canCut, click: () => contents.cut() },
      { label: 'نسخ', enabled: editFlags.canCopy, click: () => contents.copy() },
      { label: 'لصق', enabled: editFlags.canPaste, click: () => contents.paste() },
      { type: 'separator' },
      { label: 'تحديد الكل', enabled: editFlags.canSelectAll, click: () => contents.selectAll() }
    );
  } else if (hasSelection) {
    template.push({ label: 'نسخ', enabled: editFlags.canCopy, click: () => contents.copy() });
  }
  return template.length ? Menu.buildFromTemplate(template) : null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: fs.existsSync(WINDOW_ICON) ? WINDOW_ICON : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // التطبيق يعمل دون إنترنت: لا حاجة لأي إذن من الويب (كاميرا/موقع/ميكروفون)
      preload: path.join(__dirname, 'preload.cjs')
    },
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#ffffff'
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(APP_INDEX);
  }

  const contents = mainWindow.webContents;

  // قائمة الزر الأيمن العربية (قص/نسخ/لصق) في الحقول والنص المحدد
  contents.on('context-menu', (_event, params) => {
    const menu = buildContextMenu(contents, params);
    if (menu && mainWindow) menu.popup({ window: mainWindow });
  });

  // التكبير: Ctrl + عجلة الفأرة، و Ctrl و + / - / 0 من لوحة المفاتيح
  contents.on('did-finish-load', () => {
    const { zoomLevel } = readWindowState();
    if (Number.isFinite(zoomLevel)) contents.setZoomLevel(zoomLevel);
  });
  contents.on('zoom-changed', (_event, direction) => {
    applyZoom(contents, contents.getZoomLevel() + (direction === 'in' ? 0.5 : -0.5));
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd') {
      event.preventDefault();
      applyZoom(contents, contents.getZoomLevel() + 0.5);
    } else if (input.key === '-' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      applyZoom(contents, contents.getZoomLevel() - 0.5);
    } else if (input.key === '0' || input.code === 'Numpad0') {
      event.preventDefault();
      applyZoom(contents, 0);
    }
  });

  /* ------------------------- أذونات الويب -------------------------
   * تطبيق محلي بالكامل: لا يحتاج الموقع/الكاميرا/الميكروفون/القرص.
   * نسمح فقط بالإشعارات (وإن كنا نُظهرها من العملية الرئيسية) والكتابة في
   * الحافظة؛ وكل ما عداها يُرفض صريحاً بدل سلوك Chromium الافتراضي.
   */
  const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write']);
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );

  // منع فتح نوافذ فرعية داخل التطبيق وتحويل الروابط الخارجية للمتصفح
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  /* ----------------------- زر الرجوع (الفأرة و Alt+←) -----------------------
   * يُعالَج داخل الواجهة (`src/lib/desktopBack.ts`) لا هنا: الواجهة تلتقط زر
   * الفأرة الخلفي و Alt+← وتلغي سلوك Chromium الافتراضي، ثم تطبّق نفس قواعد
   * زر أندرويد (إغلاق النافذة ← الصفحة السابقة ← تأكيد الخروج في الرئيسية).
   * لا نضيف `app-command`/`goBack()` هنا عمداً: كان ذلك سيُنتج رجوعاً مزدوجاً
   * ويتجاوز حوار تأكيد الخروج.
   */

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode === -3) return; // ERR_ABORTED (تنقّل سريع) — تجاهل
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // الوصف التقني من Chromium إنجليزي: نعرض رمز الخطأ الرقمي فقط (يكفي للدعم الفني)
    const safeCode = Number.isFinite(errorCode) ? String(errorCode) : '';
    mainWindow
      .loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
       body{font-family:Segoe UI,Tahoma,sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0}
       .card{max-width:560px;padding:28px;background:#1f2937;border-radius:16px;border:1px solid #374151;text-align:center}
       button{margin:6px;padding:10px 22px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-size:15px;cursor:pointer}
       .code{font-size:12px;color:#9ca3af}</style></head>
       <body><div class="card"><h1>⚠️ تعذّر تحميل واجهة التطبيق</h1>
       <p>فشل تحميل ملفات الواجهة داخل التطبيق. أعد التحميل، وإن تكرر الخطأ أعد تثبيت التطبيق — بياناتك محفوظة ولن تتأثر.</p>
       <p class="code">رمز الخطأ: ${safeCode}</p>
       <button onclick="location.reload()">إعادة التحميل</button>
       <button onclick="window.close()">إغلاق</button></div></body></html>`
          )
      )
      .catch((error) => console.error('تعذّر عرض صفحة الخطأ:', error));
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('الواجهة لا تستجيب');
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.maximize();
  });

  if (SMOKE_TEST) {
    const fail = (message) => {
      console.error(`SMOKE_FAILED: ${message}`);
      app.exit(1);
    };
    const timeout = setTimeout(() => fail('انتهت المهلة دون تحميل الواجهة'), 45000);

    /**
     * انتظار جاهزية التطبيق فعلياً: انتهاء الإقلاع (data-app-boot) **وإنشاء
     * قاعدة البيانات المحلية** — والإقلاع لا يُعتبر ناجحاً إن فشل فتح IndexedDB
     * (`storage-error`). هذا ما يمنع تسليم مُثبِّت يفتح واجهة لكن لا يستطيع
     * القراءة/الكتابة.
     */
    const waitForAppReady = async () => {
      const deadline = Date.now() + 30000;
      let last = {};
      while (Date.now() < deadline) {
        try {
          last = await mainWindow.webContents.executeJavaScript(
            `(async () => {
               let dbCount = 0;
               try { dbCount = (await indexedDB.databases()).length; } catch { dbCount = 0; }
               return {
                 boot: document.documentElement.dataset.appBoot || 'loading',
                 rootChildren: document.getElementById('root')?.childElementCount ?? 0,
                 dbCount
               };
             })()`
          );
        } catch (error) {
          last = { boot: 'error', error: String(error) };
        }
        if (last.boot === 'storage-error') return last;
        if ((last.boot === 'ready' || last.boot === 'setup') && last.rootChildren > 0 && last.dbCount > 0) {
          return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return last;
    };

    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const readiness = await waitForAppReady();
        if (readiness.boot === 'storage-error') return fail('فشل فتح قاعدة البيانات المحلية على هذا الجهاز');
        if (readiness.boot !== 'ready' && readiness.boot !== 'setup') {
          return fail(`لم يكتمل إقلاع التطبيق (الحالة: ${readiness.boot})`);
        }
        if (!readiness.dbCount) return fail('قاعدة البيانات المحلية لم تُنشأ');

        const result = await mainWindow.webContents.executeJavaScript(
          `({
             title: document.title,
             hasRoot: Boolean(document.getElementById('root')),
             rootChildren: document.getElementById('root')?.childElementCount ?? 0,
             hasBridge: typeof window.electronAPI === 'object' && window.electronAPI !== null,
             bridgeMethods: Object.keys(window.electronAPI || {}).sort()
           })`
        );
        if (!result.hasRoot || result.rootChildren === 0) return fail('الواجهة لم تُرسم (root فارغ)');
        if (!result.hasBridge) return fail('جسر preload غير متاح (electronAPI)');
        for (const method of ['appInfo', 'isElectron', 'saveFile', 'saveBackup', 'printDocument', 'showNotification']) {
          if (!result.bridgeMethods.includes(method)) return fail(`دالة الجسر مفقودة: ${method}`);
        }
        const info = await mainWindow.webContents.executeJavaScript('window.electronAPI.appInfo()');
        if (!info?.isElectron) return fail('appInfo لم تُرجع معلومات Electron');
        const invalidSave = await mainWindow.webContents.executeJavaScript(
          "window.electronAPI.saveFile('../evil.txt', btoa('x'), 'text/plain')"
        );
        if (invalidSave?.success) return fail('قُبل اسم ملف غير صالح');
        if (!String(invalidSave?.error || '').includes('غير صالح')) {
          return fail(`رفض الحفظ لسبب غير متوقع: ${invalidSave?.error || 'بلا رسالة'}`);
        }
        const emptyPrint = await mainWindow.webContents.executeJavaScript("window.electronAPI.printDocument('')");
        if (emptyPrint?.success) return fail('قُبل مستند طباعة فارغ');
        await runFilesystemSmoke(app.getPath('temp'));
        clearTimeout(timeout);
        console.log(
          `SMOKE_OK ${JSON.stringify({
            title: result.title,
            boot: readiness.boot,
            databases: readiness.dbCount,
            bridge: result.bridgeMethods
          })}`
        );
        app.exit(0);
      } catch (error) {
        clearTimeout(timeout);
        fail(error.message);
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------------------- تحصين كل صفحات الويب ---------------------- */
app.on('web-contents-created', (_event, contents) => {
  // لا إضافات <webview> ولا نوافذ فرعية: التطبيق صفحة واحدة محلية
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
});

/* ------------------------- نسخة وحيدة من التطبيق ------------------------- */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // لا قائمة تطبيق: قائمة Electron الافتراضية إنجليزية (File/Edit/View...)
    // ولا حاجة لها — التنقل كله داخل الواجهة، واختصارات التحرير (Ctrl+C/V/X/Z/A)
    // تعمل في الحقول دون قائمة على ويندوز، والتكبير معالج أعلاه.
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

/* ------------------------------- قنوات IPC ------------------------------- */

ipcMain.handle('save-backup', async (event, payload) => {
  if (rejectUntrustedIpc(event, 'save-backup')) return { success: false, error: 'مصدر الطلب غير موثوق' };
  try {
    const fileName = safeFileName(payload?.fileName);
    if (!fileName) return { success: false, error: 'اسم الملف غير صالح' };
    if (typeof payload?.data !== 'string') return { success: false, error: 'لا توجد بيانات للحفظ' };

    const suggestedDir = path.join(app.getPath('downloads'), APP_FOLDER);
    await fsp.mkdir(suggestedDir, { recursive: true }).catch(() => {});

    const options = {
      title: 'حفظ النسخة الاحتياطية',
      buttonLabel: 'حفظ',
      defaultPath: path.join(suggestedDir, fileName),
      filters: [{ name: 'ملف نسخة احتياطية', extensions: ['json'] }]
    };
    const { filePath } = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

    if (!filePath) return { success: false, cancelled: true };

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomically(filePath, payload.data, 'utf8');

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, payload) => {
  if (rejectUntrustedIpc(event, 'save-file')) return { success: false, error: 'مصدر الطلب غير موثوق' };
  try {
    const fileName = safeFileName(payload?.fileName);
    if (!fileName) return { success: false, error: 'اسم الملف غير صالح' };
    if (typeof payload?.data !== 'string' || payload.data.length === 0) {
      return { success: false, error: 'لا توجد بيانات للحفظ' };
    }

    // أسماء أنواع الملفات بالعربية في صندوق حفظ ويندوز (بدل PDF/JSON)
    const extension = (fileName.split('.').pop() || '').toLowerCase();
    const filters = [];
    if (extension === 'pdf') filters.push({ name: 'مستند', extensions: ['pdf'] });
    else if (extension === 'json') filters.push({ name: 'ملف نسخة احتياطية', extensions: ['json'] });
    else if (extension === 'csv') filters.push({ name: 'جدول بيانات', extensions: ['csv'] });
    else filters.push({ name: 'ملفات', extensions: [extension || '*'] });

    const suggestedDir = path.join(app.getPath('downloads'), APP_FOLDER);
    await fsp.mkdir(suggestedDir, { recursive: true }).catch(() => {});

    const options = {
      title: 'حفظ الملف',
      buttonLabel: 'حفظ',
      defaultPath: path.join(suggestedDir, fileName),
      filters
    };
    const { filePath } = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

    if (!filePath) return { success: false, cancelled: true };

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomically(filePath, Buffer.from(payload.data, 'base64'));

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * طباعة مستند (فاتورة/وصل/كشف) من الواجهة.
 *
 * لماذا مسار خاص بدل `window.print()`؟ لأن Electron لا ينفّذ `window.print`
 * إطلاقاً (رسالة دقيقة من توثيق المكتبات المعتمدة: «Electron does not
 * natively support the window.print method»)، فكان زر الطباعة على ويندوز
 * لا يفعل شيئاً. الطريقة الصحيحة هنا: نافذة مخفية تُحمَّل بمستند HTML في ملف
 * مؤقت، ثم `webContents.print` الذي يفتح حوار الطباعة الأصلي — ويحترم
 * `@page { size: A4; margin: 10mm }` داخل المستند نفسه، فيخرج الورق مطابقاً
 * للمعاينة وملف المستند.
 */
ipcMain.handle('print-document', async (event, payload) => {
  if (rejectUntrustedIpc(event, 'print-document')) return { success: false, error: 'مصدر الطلب غير موثوق' };
  const html = typeof payload?.html === 'string' ? payload.html : '';
  if (!html) return { success: false, error: 'لا يوجد مستند للطباعة' };

  let tempDir = null;
  let printWindow = null;
  try {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'office-print-'));
    const filePath = path.join(tempDir, 'document.html');
    await fsp.writeFile(filePath, html, 'utf8');

    printWindow = new BrowserWindow({
      show: false,
      // حجم الورقة قريب من A4 بالبكسل: نفس مقاس مستند المعاينة
      width: 794,
      height: 1123,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    await printWindow.loadFile(filePath);

    const result = await new Promise((resolve) => {
      printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        resolve(classifyPrintCallback(success, failureReason));
      });
    });
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

ipcMain.handle('show-notification', async (event, payload) => {
  if (rejectUntrustedIpc(event, 'show-notification')) return { success: false, error: 'مصدر الطلب غير موثوق' };
  try {
    const title = String(payload?.title || 'إدارة المكتب').slice(0, 200);
    const body = String(payload?.body || '').slice(0, 500);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        icon: fs.existsSync(NOTIFICATION_ICON) ? NOTIFICATION_ICON : undefined
      });
      // النقر على الإشعار يُظهر التطبيق (نفس سلوك أندرويد: النقر يفتح التطبيق)
      notification.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });
      notification.show();
      return { success: true };
    }
    return { success: false, error: 'الإشعارات غير مدعومة' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app-info', async (event) => {
  if (rejectUntrustedIpc(event, 'app-info')) return { isElectron: false, error: 'مصدر الطلب غير موثوق' };
  return {
    version: app.getVersion(),
    platform: process.platform,
    isElectron: true
  };
});
