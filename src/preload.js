const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, arg) => ipcRenderer.invoke(channel, arg),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
});
