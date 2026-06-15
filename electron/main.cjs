// electron/main.cjs
const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { stage } = require('./staging.cjs');
const { startDrag, copyFiles, saveToFolder } = require('./native-ops.cjs');
const { API_BASE } = require('./config.cjs');

// Repo root holds index.html (one level up from electron/).
const APP_ROOT = path.join(__dirname, '..');

// Must run before app is ready: make app:// a standard, secure scheme so
// showDirectoryPicker / clipboard / crypto.randomUUID behave as on https://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pass config to the sandboxed preload via argv — a sandboxed preload
      // cannot require() local files like ./config.cjs.
      additionalArguments: [`--dam-api-base=${API_BASE}`],
    },
  });
  mainWindow.loadURL('app://bundle/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.join(APP_ROOT, rel);
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  const stagedDirs = [];

  // Drag-out is two-phase so startDrag can fire synchronously inside the
  // dragstart gesture: 'prepare-drag' stages files (async, on pointerdown) and
  // returns their paths; 'begin-drag' (on dragstart) fires startDrag at once.
  ipcMain.handle('prepare-drag', async (e, specs) => {
    const { dir, paths } = await stage(specs);
    stagedDirs.push(dir);
    return paths;
  });

  ipcMain.on('begin-drag', (e, paths) => {
    if (Array.isArray(paths) && paths.length) {
      startDrag(e.sender, paths); // native-ops supplies the macOS document icon
    }
  });

  ipcMain.handle('stage-and-copy', async (e, specs) => {
    const { dir, paths } = await stage(specs);
    stagedDirs.push(dir);
    return { copied: copyFiles(paths) };
  });

  ipcMain.handle('stage-and-save', async (e, specs) => {
    const { dir, paths } = await stage(specs);
    stagedDirs.push(dir);
    return saveToFolder(BrowserWindow.fromWebContents(e.sender), paths);
  });

  app.on('window-all-closed', () => {
    const fs = require('fs');
    for (const d of stagedDirs) fs.rmSync(d, { recursive: true, force: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
