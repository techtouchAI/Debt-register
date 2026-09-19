const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveBackup: (fileName, data) => ipcRenderer.invoke('save-backup', { fileName, data }),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  isElectron: true
});
