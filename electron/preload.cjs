// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
const { API_BASE } = require('./config.cjs');

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase:      API_BASE,
  startDrag:    (specs) => ipcRenderer.invoke('stage-and-drag', specs),
  copyFiles:    (specs) => ipcRenderer.invoke('stage-and-copy', specs),
  saveToFolder: (specs) => ipcRenderer.invoke('stage-and-save', specs),
});
