const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

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

const APP_ICON = path.join(__dirname, '../public/pwa-192x192.png');
let mainWindow = null;

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
 * 2) النسخة المثبّتة: اسم مجلد userData الافتراضي مشتق من اسم العرض
 *    (`productName`). وعند تغيير اسم التطبيق إلى اسم عام (إدارة المكتب)
 *    كان المسار الافتراضي سيتبدّل، فيجد المستخدم القائم قاعدة بيانات فارغة
 *    وكأن فواتيره وديونه اختفت. لذلك نُبقي المسار على المجلد القديم **إن
 *    وُجد** (ترحيل شفّاف بلا فقدان بيانات)، ونستخدم الاسم الجديد للتثبيتات
 *    الجديدة فقط.
 */
const LEGACY_USER_DATA_DIRS = ['إدارة المكتب الزراعي', 'debt-register-agri-office'];

function configureUserDataDir() {
  try {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      const dataDir = path.join(portableDir, 'AgriOfficeData');
      fs.mkdirSync(dataDir, { recursive: true });
      app.setPath('userData', dataDir);
      app.setPath('sessionData', dataDir);
      return;
    }

    // نسخة مثبّتة: أبقِ بيانات المستخدم القائم في مكانها
    const appDataDir = app.getPath('appData');
    const legacy = LEGACY_USER_DATA_DIRS.map((name) => path.join(appDataDir, name)).find((dir) =>
      fs.existsSync(path.join(dir, 'IndexedDB'))
    );
    if (!legacy) return; // تثبيت جديد: الاسم الجديد هو المسار الافتراضي
    app.setPath('userData', legacy);
    app.setPath('sessionData', legacy);
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

/** هل الرابط جزء من التطبيق نفسه؟ */
function isInternalUrl(target) {
  try {
    const url = new URL(target);
    if (url.protocol === 'file:') return true;
    if (isDev && url.hostname === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
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
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
    const safeUrl = String(validatedURL || '').replace(/[&<>"']/g, '');
    mainWindow
      .loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
       body{font-family:Segoe UI,Tahoma,sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0}
       .card{max-width:560px;padding:28px;background:#1f2937;border-radius:16px;border:1px solid #374151;text-align:center}
       button{margin:6px;padding:10px 22px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-size:15px;cursor:pointer}
       pre{font-size:11px;color:#9ca3af;text-align:left;overflow:auto}</style></head>
       <body><div class="card"><h1>⚠️ تعذّر تحميل واجهة التطبيق</h1>
       <p>فشل تحميل الملف المطلوب داخل التطبيق المُجمّع.</p>
       <pre>${errorCode} — ${errorDescription}\n${safeUrl}</pre>
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
        for (const method of ['appInfo', 'isElectron', 'saveFile', 'saveBackup', 'showNotification']) {
          if (!result.bridgeMethods.includes(method)) return fail(`دالة الجسر مفقودة: ${method}`);
        }
        const info = await mainWindow.webContents.executeJavaScript('window.electronAPI.appInfo()');
        if (!info?.isElectron) return fail('appInfo لم تُرجع معلومات Electron');
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

/** منع اجتياز المسار: اسم الملف لا يجب أن يحتوي فواصل مسارات. */
function safeFileName(fileName) {
  const base = path.basename(String(fileName || ''));
  return base && base !== '.' && base !== '..' ? base : null;
}

ipcMain.handle('save-backup', async (_event, payload) => {
  try {
    const fileName = safeFileName(payload?.fileName);
    if (!fileName) return { success: false, error: 'اسم الملف غير صالح' };
    if (typeof payload?.data !== 'string') return { success: false, error: 'لا توجد بيانات للحفظ' };

    const downloads = app.getPath('downloads');
    const suggestedDir = path.join(downloads, 'OfficeManager');
    await fsp.mkdir(suggestedDir, { recursive: true }).catch(() => {});

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(suggestedDir, fileName),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) return { success: false, cancelled: true };

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    // كتابة ذرّية: ملف مؤقت ثم إعادة تسمية، حتى لا تترك نسخة ناقصة عند الانقطاع
    const tempPath = `${filePath}.tmp`;
    await fsp.writeFile(tempPath, payload.data, 'utf8');
    await fsp.rename(tempPath, filePath);

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (_event, payload) => {
  try {
    const fileName = safeFileName(payload?.fileName);
    if (!fileName) return { success: false, error: 'اسم الملف غير صالح' };
    if (typeof payload?.data !== 'string' || payload.data.length === 0) {
      return { success: false, error: 'لا توجد بيانات للحفظ' };
    }

    const extension = (fileName.split('.').pop() || '').toLowerCase();
    const filters = [];
    if (extension === 'pdf') filters.push({ name: 'PDF', extensions: ['pdf'] });
    else if (extension === 'json') filters.push({ name: 'JSON', extensions: ['json'] });
    else filters.push({ name: 'ملفات', extensions: [extension || '*'] });

    const downloads = app.getPath('downloads');
    const suggestedDir = path.join(downloads, 'AgriOffice');
    await fsp.mkdir(suggestedDir, { recursive: true }).catch(() => {});

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(suggestedDir, fileName),
      filters
    });

    if (!filePath) return { success: false, cancelled: true };

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    // كتابة ذرّية: ملف مؤقت ثم إعادة تسمية
    const tempPath = `${filePath}.tmp`;
    await fsp.writeFile(tempPath, Buffer.from(payload.data, 'base64'));
    await fsp.rename(tempPath, filePath);

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-notification', async (_event, payload) => {
  try {
    const title = String(payload?.title || 'إدارة المكتب').slice(0, 200);
    const body = String(payload?.body || '').slice(0, 500);
    if (Notification.isSupported()) {
      new Notification({
        title,
        body,
        icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined
      }).show();
      return { success: true };
    }
    return { success: false, error: 'الإشعارات غير مدعومة' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app-info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  isElectron: true
}));
