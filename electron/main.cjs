// electron/main.cjs
const { app, BrowserWindow, protocol, net, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { stage } = require('./staging.cjs');
const { startDrag, copyFiles, saveToFolder } = require('./native-ops.cjs');
const { API_BASE } = require('./config.cjs');
const aiKey = require('./ai-key.cjs');
const { suggestTags, testKey } = require('./suggest-tags.cjs');

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
  // damlocal://local/{filename} — streams files from the user's Local-mode
  // folder. `stream: true` enables HTTP range requests so videos can scrub.
  { scheme: 'damlocal', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// Root of the Local-mode folder. Renderer pushes this in via local:setRoot at
// boot and whenever the user picks a new folder. The damlocal:// handler
// refuses to serve anything until it's set.
let localRoot = null;

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

  protocol.handle('damlocal', (request) => {
    if (!localRoot) return new Response('Local folder not set', { status: 503 });
    const url = new URL(request.url);
    const filename = decodeURIComponent(url.pathname.replace(/^\//, ''));
    try {
      const filePath = safeJoin(localRoot, filename);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Bad filename', { status: 400 });
    }
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

  // Native picker for the Add-asset drop zone — allows files AND folders in a
  // single dialog (HTML <input> can only do one). Walks any directories and
  // returns a flat list of { name, bytes } for the renderer to wrap in File.
  ipcMain.handle('dialog:pickImport', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const filePaths = [];
    async function walk(p) {
      const stat = await fsp.stat(p);
      if (stat.isDirectory()) {
        const entries = await fsp.readdir(p, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.name.startsWith('.')) continue;
          await walk(path.join(p, ent.name));
        }
      } else if (stat.isFile()) {
        filePaths.push(p);
      }
    }
    for (const p of result.filePaths) await walk(p);
    const files = [];
    for (const fp of filePaths) {
      const bytes = await fsp.readFile(fp);
      files.push({ name: path.basename(fp), bytes });
    }
    return files;
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

  // Fast path for large files: copy directly from a native source path. Avoids
  // pulling the whole file into renderer memory and across IPC.
  ipcMain.handle('local:copyFromPath', async (e, dirPath, filename, sourcePath) => {
    await fsp.copyFile(sourcePath, safeJoin(dirPath, filename));
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

  // Track the active Local-mode folder so damlocal:// can stream from it.
  ipcMain.handle('local:setRoot', async (e, dirPath) => {
    localRoot = typeof dirPath === 'string' && dirPath ? dirPath : null;
  });

  // Native Save-As: copy a Local-mode file to a user-chosen location with
  // fs.copyFile. Zero bytes through IPC, so large videos work.
  ipcMain.handle('local:saveAs', async (e, filename, suggestedName) => {
    if (!localRoot) throw new Error('Local folder not set');
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || filename,
    });
    if (canceled || !filePath) return { saved: false };
    await fsp.copyFile(safeJoin(localRoot, filename), filePath);
    return { saved: true, filePath };
  });

  // AI tag suggestions — user-supplied Google Vision API key, stored encrypted
  // via safeStorage. Raw key never crosses the IPC boundary back to renderer.
  ipcMain.handle('ai:getKeyStatus', () => ({ hasKey: aiKey.hasKey() }));

  ipcMain.handle('ai:saveKey', async (e, plaintext) => {
    await aiKey.writeKey(plaintext);
    return { ok: true };
  });

  ipcMain.handle('ai:clearKey', async () => {
    await aiKey.clearKey();
    return { ok: true };
  });

  ipcMain.handle('ai:testKey', async (e, plaintext) => {
    const key = (plaintext && plaintext.trim()) || (await aiKey.readKey());
    if (!key) return { ok: false, error: 'No key provided or stored' };
    return testKey({ key });
  });

  ipcMain.handle('ai:suggestTags', async (e, { thumbnail, filename, fileType }) => {
    const key = await aiKey.readKey().catch(() => null);
    return suggestTags({ key, thumbnail, filename, fileType });
  });

  app.on('window-all-closed', () => {
    const fs = require('fs');
    for (const d of stagedDirs) fs.rmSync(d, { recursive: true, force: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
