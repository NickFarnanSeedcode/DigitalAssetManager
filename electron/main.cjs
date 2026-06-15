// electron/main.cjs
const { app, BrowserWindow, protocol, net, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { stage } = require('./staging.cjs');
const { startDrag, copyFiles, saveToFolder } = require('./native-ops.cjs');
const { API_BASE } = require('./config.cjs');

// Reject filenames that try to escape the local-mode folder. Asset filenames
// are always "{uuid}.{ext}" so anything with a separator is a bug or attack.
function safeJoin(dirPath, filename) {
  if (typeof dirPath !== 'string' || typeof filename !== 'string') {
    throw new Error('Invalid path');
  }
  if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new Error(`Invalid filename: ${filename}`);
  }
  return path.join(dirPath, filename);
}

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

  ipcMain.on('begin-drag', (e, { paths, icon } = {}) => {
    if (!Array.isArray(paths) || !paths.length) return;
    // Use the asset's thumbnail as the drag icon when it decodes; otherwise
    // native-ops falls back to the macOS document icon. Never let a bad
    // thumbnail throw and break the drag.
    let dragIcon = null;
    if (icon) {
      try {
        const img = nativeImage.createFromDataURL(icon);
        if (!img.isEmpty()) dragIcon = img;
      } catch {}
    }
    startDrag(e.sender, paths, dragIcon);
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

  // Local-mode file IO. Node fs has no permission prompt, so the app reopens
  // its saved folder silently on launch — no reconnect dance.
  ipcMain.handle('local:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('local:readManifest', async (e, dirPath) => {
    try {
      const text = await fsp.readFile(path.join(dirPath, 'dam_data.json'), 'utf8');
      return JSON.parse(text);
    } catch (err) {
      if (err.code === 'ENOENT') return { assets: [] };
      throw err;
    }
  });

  ipcMain.handle('local:writeManifest', async (e, dirPath, data) => {
    await fsp.writeFile(
      path.join(dirPath, 'dam_data.json'),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  });

  ipcMain.handle('local:writeFile', async (e, dirPath, filename, bytes) => {
    await fsp.writeFile(safeJoin(dirPath, filename), Buffer.from(bytes));
  });

  ipcMain.handle('local:readFile', async (e, dirPath, filename) => {
    return await fsp.readFile(safeJoin(dirPath, filename));
  });

  ipcMain.handle('local:deleteFile', async (e, dirPath, filename) => {
    try {
      await fsp.unlink(safeJoin(dirPath, filename));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  });

  app.on('window-all-closed', () => {
    const fs = require('fs');
    for (const d of stagedDirs) fs.rmSync(d, { recursive: true, force: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
