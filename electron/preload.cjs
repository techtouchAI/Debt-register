const { contextBridge, ipcRenderer } = require('electron');

/**
 * جسر آمن بين العملية الرئيسية والواجهة.
 * يُعرّض دوال محددة فقط — لا وصول مباشر إلى ipcRenderer أو Node.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  saveBackup: (fileName, data) => ipcRenderer.invoke('save-backup', { fileName, data }),
  saveFile: (fileName, base64Data, mimeType) => ipcRenderer.invoke('save-file', { fileName, data: base64Data, mimeType }),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  appInfo: () => ipcRenderer.invoke('app-info'),
  isElectron: true
});
