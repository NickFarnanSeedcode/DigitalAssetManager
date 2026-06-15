# Electron Native Multi-Asset Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing DigitalDAM web app in an Electron desktop shell that adds native multi-asset drag-out, copy-as-files, and save-to-folder — for both Cloud and Local storage modes — without changing the web app's behavior.

**Architecture:** Electron loads the existing self-contained `index.html` over a custom secure `app://` protocol. The renderer feature-detects `window.electronAPI`; when present it sends "asset specs" to the main process, which stages the selected assets into a temp directory and performs the native OS operation on those real file paths. Cloud specs carry a URL (fetched in main); Local specs carry bytes (read in the renderer from object URLs).

**Tech Stack:** Electron (main process in CommonJS `.cjs`), `electron-builder` (macOS dmg), Node's built-in `node:test` for unit tests, vanilla JS renderer (unchanged stack).

---

## Conventions

- All Electron files use the `.cjs` extension. The project's `package.json` has `"type": "module"`, so `.cjs` guarantees CommonJS regardless — this is the most reliable setup for Electron main/preload.
- Tests use the built-in `node:test` runner and `node:assert/strict`. No test deps to install.
- Commit after every task. Use the existing repo (branch `main` is fine for this work, or a feature branch if you prefer).

## File Structure

| File | Responsibility |
|---|---|
| `electron/config.cjs` | Single source of `API_BASE` (your Vercel origin) for Cloud `/api/*` calls. |
| `electron/staging.cjs` | `safeFilename()` + `stage()` — turn specs into real temp files. Pure-ish, unit-tested. |
| `electron/native-ops.cjs` | `buildFilenamesPlist()`, `startDrag()`, `copyFiles()`, `saveToFolder()`. |
| `electron/preload.cjs` | Exposes typed `window.electronAPI` via `contextBridge`. |
| `electron/main.cjs` | App lifecycle, `app://` protocol, BrowserWindow, IPC wiring, temp cleanup. |
| `electron/staging.test.cjs` | Tests for `safeFilename` + `stage`. |
| `electron/native-ops.test.cjs` | Tests for `buildFilenamesPlist`. |
| `electron-builder.yml` | macOS dmg packaging config (arm64, unsigned). |
| `index.html` | Additive renderer bridge + one-line `API_BASE` prefix on the 6 `fetch` calls + a Save-to-folder button. |
| `package.json` | Add `electron`/`electron-builder` devDeps and `electron`, `dist`, `test` scripts. |

---

## Task 1: Project scaffolding & secure `app://` shell

Get a launchable Electron window that loads the existing app over `app://` and proves Local mode (`showDirectoryPicker`) works under it. This validates the core risk before any feature work.

**Files:**
- Create: `electron/config.cjs`, `electron/preload.cjs`, `electron/main.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add Electron dev dependencies**

Run:
```bash
npm install --save-dev electron@^31 electron-builder@^24
```
Expected: `electron` and `electron-builder` appear under `devDependencies` in `package.json`.

- [ ] **Step 2: Create `electron/config.cjs`**

Set `API_BASE` to your real Vercel deployment origin (no trailing slash). You can override at runtime with the `DAM_API_BASE` env var.

```javascript
// electron/config.cjs
// The origin Cloud-mode /api/* calls are sent to when running under app://.
// Replace the fallback with your actual Vercel deployment domain.
const API_BASE = process.env.DAM_API_BASE || 'https://digitalassetmanager.vercel.app';

module.exports = { API_BASE };
```

- [ ] **Step 3: Create `electron/preload.cjs`**

```javascript
// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
const { API_BASE } = require('./config.cjs');

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase:      API_BASE,
  startDrag:    (specs) => ipcRenderer.invoke('stage-and-drag', specs),
  copyFiles:    (specs) => ipcRenderer.invoke('stage-and-copy', specs),
  saveToFolder: (specs) => ipcRenderer.invoke('stage-and-save', specs),
});
```

- [ ] **Step 4: Create `electron/main.cjs` (shell only — IPC handlers added in Task 5)**

```javascript
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
```

- [ ] **Step 5: Add the `electron` script to `package.json`**

Add a `"scripts"` block (none exists yet):
```json
  "scripts": {
    "electron": "electron electron/main.cjs"
  },
```

- [ ] **Step 6: Launch and verify the shell + secure context (manual)**

Run:
```bash
npm run electron
```
Expected:
- A desktop window opens and the DigitalDAM grid shell renders. Note: Cloud-mode asset loading will not work yet — the renderer's `fetch('/api/...')` calls are relative and have no `API_BASE` prefix until Task 6, so they fail under `app://`. That is expected at this task; the shell and Local picker are what matter here.
- Open Settings → switch to **Local**, click **Choose Folder**. The native folder picker appears and a folder can be selected without a "not a secure context" error. **This is the key risk-validation gate.** If `showDirectoryPicker` throws a secure-context error, stop and revisit the `app://` privileges before continuing.

- [ ] **Step 7: Commit**

```bash
git add electron/config.cjs electron/preload.cjs electron/main.cjs package.json package-lock.json
git commit -m "feat(electron): secure app:// shell loading the existing frontend"
```

---

## Task 2: `safeFilename` — collision-safe OS filenames

**Files:**
- Create: `electron/staging.cjs` (first export only), `electron/staging.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
// electron/staging.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeFilename } = require('./staging.cjs');

test('safeFilename sanitizes path-unsafe characters', () => {
  const used = new Set();
  assert.equal(safeFilename({ id: 'a', filename: 'a/b:c*.png' }, used), 'a_b_c_.png');
});

test('safeFilename falls back to id when filename is empty', () => {
  const used = new Set();
  assert.equal(safeFilename({ id: 'xyz', filename: '' }, used), 'xyz');
});

test('safeFilename appends a counter before the extension on collision', () => {
  const used = new Set();
  const first  = safeFilename({ id: 'a', filename: 'photo.jpg' }, used);
  const second = safeFilename({ id: 'b', filename: 'photo.jpg' }, used);
  assert.equal(first, 'photo.jpg');
  assert.equal(second, 'photo (1).jpg');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test electron/staging.test.cjs`
Expected: FAIL — `Cannot find module './staging.cjs'` or `safeFilename is not a function`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// electron/staging.cjs
const path = require('path');

// Produce a filesystem-safe, batch-unique filename. `used` is a Set of
// lowercased names already taken in this batch.
function safeFilename(spec, used) {
  let base = String(spec.filename || '').replace(/[\/\\:*?"<>|]/g, '_').trim();
  if (!base) base = String(spec.id);
  let name = base;
  let i = 1;
  while (used.has(name.toLowerCase())) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    name = `${stem} (${i})${ext}`;
    i++;
  }
  used.add(name.toLowerCase());
  return name;
}

module.exports = { safeFilename };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test electron/staging.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/staging.cjs electron/staging.test.cjs
git commit -m "feat(electron): safeFilename helper for staged assets"
```

---

## Task 3: `stage()` — write specs to a temp directory

**Files:**
- Modify: `electron/staging.cjs`, `electron/staging.test.cjs`

- [ ] **Step 1: Write the failing tests**

Append to `electron/staging.test.cjs`:
```javascript
const fs = require('node:fs');
const { stage } = require('./staging.cjs');

test('stage writes Local-mode bytes specs to disk', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const { dir, paths } = await stage([{ id: 'a', filename: 'a.bin', bytes }]);
  assert.equal(paths.length, 1);
  assert.deepEqual([...fs.readFileSync(paths[0])], [1, 2, 3, 4]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stage fetches Cloud-mode url specs via injected fetch', async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([9, 9]).buffer,
  });
  const { dir, paths } = await stage(
    [{ id: 'a', filename: 'a.png', url: 'https://x/a.png' }],
    { fetch: fakeFetch },
  );
  assert.deepEqual([...fs.readFileSync(paths[0])], [9, 9]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stage throws when a fetch fails', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => stage([{ id: 'a', filename: 'a.png', url: 'https://x/a.png' }], { fetch: fakeFetch }),
    /404/,
  );
});

test('stage gives colliding names distinct files', async () => {
  const b = new Uint8Array([0]);
  const { dir, paths } = await stage([
    { id: 'a', filename: 'p.jpg', bytes: b },
    { id: 'b', filename: 'p.jpg', bytes: b },
  ]);
  assert.equal(new Set(paths).size, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/staging.test.cjs`
Expected: FAIL — `stage is not a function`.

- [ ] **Step 3: Implement `stage` in `electron/staging.cjs`**

Add `fs`, `os`, `crypto` requires at the top, the `stage` function, and export it:
```javascript
const fs = require('fs');
const os = require('os');

// Stage a list of asset specs into a fresh temp directory and return their paths.
// Spec shape: { id, filename, bytes?: Uint8Array, url?: string }
async function stage(specs, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitaldam-'));
  const used = new Set();
  const paths = [];
  for (const spec of specs) {
    const dest = path.join(dir, safeFilename(spec, used));
    let buf;
    if (spec.bytes != null) {
      buf = Buffer.from(spec.bytes);
    } else if (spec.url) {
      const res = await fetchImpl(spec.url);
      if (!res.ok) throw new Error(`Failed to fetch ${spec.url}: ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error(`Spec for ${spec.id} has neither bytes nor url`);
    }
    fs.writeFileSync(dest, buf);
    paths.push(dest);
  }
  return { dir, paths };
}

module.exports = { safeFilename, stage };
```
(Replace the existing `module.exports = { safeFilename };` line with the combined export above. Keep the `path` require already at the top — do not duplicate it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/staging.test.cjs`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add electron/staging.cjs electron/staging.test.cjs
git commit -m "feat(electron): stage asset specs into temp files"
```

---

## Task 4: `native-ops` — drag, copy-as-files, save-to-folder

`buildFilenamesPlist` is pure and unit-tested. The three OS operations wrap Electron APIs and are verified manually in Task 6.

**Files:**
- Create: `electron/native-ops.cjs`, `electron/native-ops.test.cjs`

- [ ] **Step 1: Write the failing test for the plist builder**

```javascript
// electron/native-ops.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFilenamesPlist } = require('./native-ops.cjs');

test('buildFilenamesPlist wraps each path in a string element inside an array', () => {
  const xml = buildFilenamesPlist(['/tmp/a.png', '/tmp/b.jpg']);
  assert.match(xml, /<array>/);
  assert.match(xml, /<string>\/tmp\/a\.png<\/string>/);
  assert.match(xml, /<string>\/tmp\/b\.jpg<\/string>/);
  assert.match(xml, /<\/array>/);
});

test('buildFilenamesPlist escapes XML-special characters in paths', () => {
  const xml = buildFilenamesPlist(['/tmp/a&b.png']);
  assert.match(xml, /a&amp;b\.png/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test electron/native-ops.test.cjs`
Expected: FAIL — `Cannot find module './native-ops.cjs'`.

- [ ] **Step 3: Implement `electron/native-ops.cjs`**

```javascript
// electron/native-ops.cjs
const { clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build an NSFilenamesPboardType XML plist so Finder pastes real files (macOS).
function buildFilenamesPlist(paths) {
  const items = paths.map((p) => `\t<string>${escapeXml(p)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${items}
</array>
</plist>`;
}

// Start a native drag of real files out to Finder/desktop.
function startDrag(webContents, paths, icon) {
  if (!paths.length) return;
  webContents.startDrag({ files: paths, icon });
}

// Put real files on the macOS clipboard so a Finder paste produces files.
function copyFiles(paths) {
  if (!paths.length) return 0;
  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(buildFilenamesPlist(paths), 'utf8'));
  return paths.length;
}

// Prompt for a destination folder and copy the staged files into it.
async function saveToFolder(win, paths) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Save assets to folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return { saved: 0 };
  const destDir = filePaths[0];
  let saved = 0;
  for (const p of paths) {
    fs.copyFileSync(p, path.join(destDir, path.basename(p)));
    saved++;
  }
  return { saved };
}

module.exports = { buildFilenamesPlist, startDrag, copyFiles, saveToFolder };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test electron/native-ops.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/native-ops.cjs electron/native-ops.test.cjs
git commit -m "feat(electron): native drag, copy-as-files, save-to-folder ops"
```

---

## Task 5: Wire IPC in main + add a `test` script

**Files:**
- Modify: `electron/main.cjs`, `package.json`

- [ ] **Step 1: Import staging, native-ops, and `ipcMain`/`nativeImage` in `main.cjs`**

Change the first require line:
```javascript
const { app, BrowserWindow, protocol, net, ipcMain, nativeImage } = require('electron');
```
Add below the existing `pathToFileURL` require:
```javascript
const { stage } = require('./staging.cjs');
const { startDrag, copyFiles, saveToFolder } = require('./native-ops.cjs');
```

- [ ] **Step 2: Register the three IPC handlers and track temp dirs for cleanup**

Inside `app.whenReady().then(() => { ... })`, after `createWindow();`, add:
```javascript
  const stagedDirs = [];

  ipcMain.handle('stage-and-drag', async (e, specs) => {
    const { dir, paths } = await stage(specs);
    stagedDirs.push(dir);
    startDrag(e.sender, paths, nativeImage.createEmpty());
    return { dragged: paths.length };
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
```
(The existing top-level `window-all-closed` handler that quits on non-darwin stays as-is; this second handler only adds cleanup.)

- [ ] **Step 3: Add the `test` script to `package.json`**

Update the `"scripts"` block to:
```json
  "scripts": {
    "electron": "electron electron/main.cjs",
    "test": "node --test electron/"
  },
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from `staging.test.cjs` and `native-ops.test.cjs` (9 total).

- [ ] **Step 5: Commit**

```bash
git add electron/main.cjs package.json
git commit -m "feat(electron): wire stage-and-{drag,copy,save} IPC handlers"
```

---

## Task 6: Renderer bridge in `index.html`

Additive, feature-detected behind `window.electronAPI`. Browser behavior is unchanged.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `API_BASE` and bridge helpers at the top of the `<script>`**

Immediately after the `/* ─── API ─── */` comment (currently `index.html:1459`), insert:
```javascript
const API_BASE = window.electronAPI?.apiBase ?? '';

// Filename presented to the OS: display name with its extension.
function osFilename(a) {
  const ext = (a.ext || '').replace(/^\./, '');
  const base = a.name || a.id;
  return ext && !base.toLowerCase().endsWith('.' + ext.toLowerCase()) ? `${base}.${ext}` : base;
}

// Build native export specs for a list of asset ids.
// Cloud → { url }; Local → { bytes } read from the displayAssets object URL.
async function buildExportSpecs(ids) {
  const specs = [];
  for (const id of ids) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) continue;
    const filename = osFilename(a);
    if (storageMode === 'local') {
      const d = displayAssets.find((x) => x.id === id) || a;
      const res = await fetch(d.blobUrl);
      specs.push({ id, filename, bytes: new Uint8Array(await res.arrayBuffer()) });
    } else {
      specs.push({ id, filename, url: a.blobUrl });
    }
  }
  return specs;
}

// Resolve which ids an export action targets, given the asset the user acted on.
function exportTargetIds(id) {
  return selectedAssetIds.has(id) && selectedAssetIds.size > 0 ? [...selectedAssetIds] : [id];
}
```

- [ ] **Step 2: Prefix the six API `fetch` calls with `API_BASE`**

In the `api*` functions (`index.html:1460`–`1520`) replace each literal `'/api/...'` / `` `/api/...` `` with `` `${API_BASE}/api/...` ``:
- `fetch('/api/assets')` → `fetch(`${API_BASE}/api/assets`)`
- `fetch('/api/assets', {` → `fetch(`${API_BASE}/api/assets`, {`
- `fetch(`/api/asset/${id}`, {` (PATCH) → `fetch(`${API_BASE}/api/asset/${id}`, {`
- `fetch(`/api/asset/${id}`, { method: 'DELETE' })` → `fetch(`${API_BASE}/api/asset/${id}`, { method: 'DELETE' })`
- `fetch('/api/upload', {` → `fetch(`${API_BASE}/api/upload`, {`
- `fetch('/api/suggest-tags', {` → `fetch(`${API_BASE}/api/suggest-tags`, {`

In the browser `API_BASE` is `''`, so these stay relative and unchanged.

- [ ] **Step 3: Make cards draggable and add a dragstart handler**

In the card template return value (`index.html:1855`), change the opening `.asset-card` div to add drag attributes:
```javascript
    <div class="asset-card${isSel ? ' selected' : ''}" data-id="${a.id}" draggable="${window.electronAPI ? 'true' : 'false'}" ondragstart="handleCardDragStart('${a.id}', event)" onclick="handleCardClick('${a.id}', event)">
```

Then add the handler next to the other `window.*` card handlers (after `window.handleCardClick`, `index.html:1903`):
```javascript
window.handleCardDragStart = function(id, event) {
  if (!window.electronAPI) return;     // browser: keep default behavior
  event.preventDefault();
  buildExportSpecs(exportTargetIds(id))
    .then((specs) => { if (specs.length) window.electronAPI.startDrag(specs); })
    .catch((err) => { console.error('Drag export failed', err); showToast('Drag failed.', 'error'); });
};
```

- [ ] **Step 4: Route the Copy button through native copy-as-files in Electron**

In the `btnBulkCopy` click handler (`index.html:2079`), insert at the very top of the async function body (before the existing `const assets = ...`):
```javascript
    if (window.electronAPI) {
        const ids = [...selectedAssetIds];
        if (!ids.length) return;
        try {
            const specs = await buildExportSpecs(ids);
            await window.electronAPI.copyFiles(specs);
            showToast(`${specs.length} file${specs.length !== 1 ? 's' : ''} copied — paste into a folder.`, 'success');
        } catch (err) {
            console.error('Copy files failed', err);
            showToast('Copy failed.', 'error');
        }
        return;
    }
```
The existing browser clipboard/URL logic below stays untouched for the web build.

- [ ] **Step 5: Add a "Save to folder…" bulk-bar button (Electron only)**

In the bulk bar, after the `btnBulkCopy` button block (`index.html:1333`, the closing `</button>` before `btnBulkDelete`), insert:
```html
    <button class="btn-bulk" id="btnBulkSaveToFolder" style="display:none">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Save to folder…
    </button>
```

- [ ] **Step 6: Reveal the button and wire its handler in Electron**

Near the other bulk-bar listeners (right after the `btnBulkCopy` handler block ends, `index.html:2112`), add:
```javascript
if (window.electronAPI) {
    $('btnBulkSaveToFolder').style.display = '';
    $('btnBulkSaveToFolder').addEventListener('click', async () => {
        const ids = [...selectedAssetIds];
        if (!ids.length) return;
        try {
            const specs = await buildExportSpecs(ids);
            const { saved } = await window.electronAPI.saveToFolder(specs);
            if (saved) showToast(`Saved ${saved} file${saved !== 1 ? 's' : ''}.`, 'success');
        } catch (err) {
            console.error('Save to folder failed', err);
            showToast('Save failed.', 'error');
        }
    });
}
```

- [ ] **Step 7: Verify in Electron and verify the web build is unchanged (manual)**

Electron — run `npm run electron`, then for **both Cloud and Local** modes:
- Select 3 assets → drag the group to the Desktop → 3 real files appear.
- Select assets → **Copy** → paste into a Finder folder → real files appear.
- Select assets → **Save to folder…** → choose a folder → files are copied in.

Web regression — open `index.html` in Chrome (e.g. `vercel dev` or your deployed URL):
- No "Save to folder…" button is visible.
- Cards do not initiate a native file drag.
- The Copy button still copies an image (single) or URL text (multiple), exactly as before.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(electron): native drag/copy/save bridge in renderer"
```

---

## Task 7: Packaging — buildable `.dmg`

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json`

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.nickfarnan.digitaldam
productName: DigitalDAM
directories:
  output: dist-electron
files:
  - index.html
  - electron/**/*
  - "!electron/**/*.test.cjs"
mac:
  target:
    - target: dmg
      arch: arm64
  category: public.app-category.productivity
```

- [ ] **Step 2: Add the `dist` script and Electron entry point to `package.json`**

Add a top-level `"main"` and the `dist` script:
```json
  "main": "electron/main.cjs",
  "scripts": {
    "electron": "electron electron/main.cjs",
    "test": "node --test electron/",
    "dist": "electron-builder"
  },
```
(Keep the existing `electron` and `test` scripts; add `dist` and the `main` field.)

- [ ] **Step 3: Build the dmg (manual)**

Run:
```bash
npm run dist
```
Expected: a `.dmg` is produced under `dist-electron/`. Open it, drag DigitalDAM to Applications, then **right-click → Open** the app (unsigned → Gatekeeper prompt is expected the first time). Confirm the window launches and the grid renders.

- [ ] **Step 4: Ignore build output and commit**

Add `dist-electron/` to `.gitignore`, then:
```bash
git add .gitignore electron-builder.yml package.json
git commit -m "build(electron): electron-builder macOS dmg packaging"
```

---

## Self-Review Notes

- **Spec coverage:** drag-out (Tasks 4–6), copy-as-files (Tasks 4–6), save-to-folder (Tasks 4–6), both Cloud + Local (`buildExportSpecs` branches; verified in Task 6 Step 7), supplement-not-replace (web path untouched; Task 6 regression check), bundle + `app://` + `API_BASE` (Tasks 1, 6), unsigned dmg (Task 7), temp cleanup (Task 5), filename collisions / fetch failure (Tasks 2–3). All spec sections map to tasks.
- **Type consistency:** `electronAPI` surface (`apiBase`, `startDrag`, `copyFiles`, `saveToFolder`) is identical across `preload.cjs`, `main.cjs` IPC channels, and the renderer calls. Spec shape `{ id, filename, bytes?, url? }` is consistent across `buildExportSpecs`, `stage`, and tests.
- **Known platform note:** copy-as-files and the `NSFilenamesPboardType` plist are macOS-specific — matches the macOS-only dmg target.
