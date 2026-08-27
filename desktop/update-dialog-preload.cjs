const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movaUpdateDialog', {
  onPayload(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop-update-dialog:payload', listener);
    return () => ipcRenderer.removeListener('desktop-update-dialog:payload', listener);
  },
  respond: (response) => ipcRenderer.send('desktop-update-dialog:respond', response),
});
