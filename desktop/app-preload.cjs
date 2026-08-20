const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movaDesktopShell', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('desktop-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('desktop-window:toggle-maximize'),
  close: () => ipcRenderer.send('desktop-window:close'),
  setCallStatus: (status) => ipcRenderer.send('desktop-call:status', status),
  showNotification: (notification) => ipcRenderer.send('desktop-notification:show', notification),
  onNotificationClick(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop-notification:click', listener);
    return () => ipcRenderer.removeListener('desktop-notification:click', listener);
  },
  onSharePickerRequest(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop-share-picker:open', listener);
    return () => ipcRenderer.removeListener('desktop-share-picker:open', listener);
  },
  chooseShareSource: (requestId, sourceId) => ipcRenderer.send('desktop-share-picker:choose', requestId, sourceId),
  cancelSharePicker: (requestId) => ipcRenderer.send('desktop-share-picker:cancel', requestId),
  getAutoLaunch: () => ipcRenderer.invoke('desktop-settings:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop-settings:set-auto-launch', enabled),
  getSystemIdleTime: () => ipcRenderer.invoke('desktop-activity:get-system-idle-time'),
  getGameActivity: () => ipcRenderer.invoke('desktop-activity:get-game'),
  onGameActivityChange(callback) {
    const listener = (_event, activity) => callback(activity);
    ipcRenderer.on('desktop-activity:game-change', listener);
    return () => ipcRenderer.removeListener('desktop-activity:game-change', listener);
  },
  isMaximized: () => ipcRenderer.invoke('desktop-window:is-maximized'),
  onMaximizedChange(callback) {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('desktop-window:maximized-change', listener);
    return () => ipcRenderer.removeListener('desktop-window:maximized-change', listener);
  },
});
