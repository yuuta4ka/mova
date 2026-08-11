const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movaSharePicker', {
  onSources(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('share-picker:sources', listener);
    return () => ipcRenderer.removeListener('share-picker:sources', listener);
  },
  choose(sourceId) {
    if (typeof sourceId === 'string') ipcRenderer.send('share-picker:choose', sourceId);
  },
  cancel() {
    ipcRenderer.send('share-picker:cancel');
  },
});
