const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, '../public/pwa-192x192.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#ffffff'
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // عرض صفحة خطأ عربية بدلاً من نافذة سوداء صامتة عند فشل تحميل الأصول
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode === -3) return; // ERR_ABORTED (تنقّل سريع) — تجاهل
    const safeUrl = String(validatedURL || '').replace(/[&<>"']/g, '');
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
       body{font-family:Segoe UI,Tahoma,sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0}
       .card{max-width:560px;padding:28px;background:#1f2937;border-radius:16px;border:1px solid #374151;text-align:center}
       button{margin:6px;padding:10px 22px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-size:15px;cursor:pointer}
       pre{font-size:11px;color:#9ca3af;text-align:left;overflow:auto}</style></head>
       <body><div class="card"><h1>⚠️ تعذّر تحميل واجهة التطبيق</h1>
       <p>فشل تحميل الملف المطلوب داخل التطبيق المُجمّع.</p>
       <pre>${errorCode} — ${errorDescription}\n${safeUrl}</pre>
       <button onclick="location.reload()">إعادة التحميل</button>
       <button onclick="window.close()">إغلاق</button></div></body></html>`));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('save-backup', async (event, { fileName, data }) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), `AgriOffice/${fileName}`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    
    if (filePath) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, data);
      return { success: true, path: filePath };
    }
    return { success: false, cancelled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-notification', async (event, { title, body }) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, '../public/pwa-192x192.png') }).show();
  }
});
