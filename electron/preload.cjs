// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

// A sandboxed preload can only require('electron') + Node built-ins — not local
// files. API_BASE is passed from main via webPreferences.additionalArguments.
const apiArg = process.argv.find((a) => a.startsWith('--dam-api-base=')) || '';
const API_BASE = apiArg.slice('--dam-api-base='.length);

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase:      API_BASE,
  prepareDrag:  (specs) => ipcRenderer.invoke('prepare-drag', specs), // stage, return paths
  beginDrag:    (paths, icon) => ipcRenderer.send('begin-drag', { paths, icon }), // fire startDrag now
  copyFiles:    (specs) => ipcRenderer.invoke('stage-and-copy', specs),
  saveToFolder: (specs) => ipcRenderer.invoke('stage-and-save', specs),
  // Local-mode file IO over Node fs. Bypasses the File System Access API
  // (no permission prompt on launch).
  local: {
    pickFolder:     ()                          => ipcRenderer.invoke('local:pickFolder'),
    readManifest:   (dirPath)                   => ipcRenderer.invoke('local:readManifest',  dirPath),
    writeManifest:  (dirPath, data)             => ipcRenderer.invoke('local:writeManifest', dirPath, data),
    writeFile:      (dirPath, filename, bytes)  => ipcRenderer.invoke('local:writeFile',     dirPath, filename, bytes),
    readFile:       (dirPath, filename)         => ipcRenderer.invoke('local:readFile',      dirPath, filename),
    deleteFile:     (dirPath, filename)         => ipcRenderer.invoke('local:deleteFile',    dirPath, filename),
  },
  // AI tag suggestions. Raw key only travels renderer→main (save/test); the
  // suggestTags call uses the stored key inside main and never returns it.
  ai: {
    getKeyStatus: ()        => ipcRenderer.invoke('ai:getKeyStatus'),
    saveKey:      (key)     => ipcRenderer.invoke('ai:saveKey', key),
    clearKey:     ()        => ipcRenderer.invoke('ai:clearKey'),
    testKey:      (key)     => ipcRenderer.invoke('ai:testKey', key),
    suggestTags:  (payload) => ipcRenderer.invoke('ai:suggestTags', payload),
  },
});
