const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movaDesktopShell', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('desktop-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('desktop-window:toggle-maximize'),
  close: () => ipcRenderer.send('desktop-window:close'),
  isMaximized: () => ipcRenderer.invoke('desktop-window:is-maximized'),
  onMaximizedChange(callback) {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('desktop-window:maximized-change', listener);
    return () => ipcRenderer.removeListener('desktop-window:maximized-change', listener);
  },
});
