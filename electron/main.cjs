// electron/main.cjs
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
