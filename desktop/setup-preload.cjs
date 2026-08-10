const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movaDesktop', {
  saveUrl: (url) => ipcRenderer.invoke('desktop:save-url', url),
});
