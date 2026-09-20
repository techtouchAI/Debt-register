const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

/**
 * نافذة سطح المكتب لنظام المكتب الزراعي.
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

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

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
      spellcheck: false,
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

  // منع فتح نوافذ فرعية داخل التطبيق وتحويل الروابط الخارجية للمتصفح
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
    const suggestedDir = path.join(downloads, 'AgriOffice');
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
    const title = String(payload?.title || 'المكتب الزراعي').slice(0, 200);
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
