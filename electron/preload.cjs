// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

// A sandboxed preload can only require('electron') + Node built-ins — not local
// files. API_BASE is passed from main via webPreferences.additionalArguments.
const apiArg = process.argv.find((a) => a.startsWith('--dam-api-base=')) || '';
const API_BASE = apiArg.slice('--dam-api-base='.length);

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase:      API_BASE,
  startDrag:    (specs) => ipcRenderer.invoke('stage-and-drag', specs),
  copyFiles:    (specs) => ipcRenderer.invoke('stage-and-copy', specs),
  saveToFolder: (specs) => ipcRenderer.invoke('stage-and-save', specs),
});
