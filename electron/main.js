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
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#ffffff'
  });

  // For production, load built files
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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

// Handle backup file save for Windows
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
