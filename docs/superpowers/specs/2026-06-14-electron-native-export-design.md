# Electron Native Multi-Asset Export — Design

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan

## Problem

DigitalDAM lets users select multiple assets, but there is no way to drag that
selection out to a Finder folder/desktop as real files. Single-asset drag
"works" only because it relies on the browser's native `<img>` element drag —
there is no custom drag code (`index.html` has no `dragstart` handler). The Copy
button (`index.html:2079`) copies one image's pixels to the clipboard, or for
multiple/non-image assets writes blob **URLs as text**, which cannot be pasted
into a folder as files.

The web platform cannot fix this: the only standard for dragging a file out of a
page is `DataTransfer.setData("DownloadURL", ...)`, which is Chromium-only and
**single-file by spec**. There is no multi-file equivalent. Wrapping the app in
Electron unlocks native OS file operations that solve it cleanly.

## Goals

- Native **multi-asset drag-out**: select N assets, drag, drop into any Finder
  folder/desktop → real files land there.
- **Copy as real files**: the Copy button produces a Finder-pasteable file list
  (not URLs) when running in Electron.
- **Save to folder…**: a native destination-folder dialog that copies the
  selected assets there.
- Support **both Cloud and Local** storage modes.
- The existing **web app on Vercel keeps working unchanged**; native features are
  additive and feature-detected.

## Non-Goals

- Code signing / notarization / distribution to other users (unsigned local
  `.dmg` only for v1).
- Streaming/chunked transfer for very large files (noted as future optimization).
- Migrating storage, changing the API, or altering the web drag/copy behavior.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Electron vs web | **Supplement** — keep Vercel web app; Electron is an additional desktop build sharing the same `index.html`. |
| Storage modes | **Both Cloud and Local.** |
| Export actions | **All three**: multi-asset drag-out, copy-as-files, save-to-folder. |
| Distribution | **Packaged `.dmg` for myself, unsigned** (right-click → Open on first launch). |
| Frontend load source | **Bundle `index.html` locally**, served via a custom secure `app://` protocol; Cloud `/api/*` calls use a configurable `API_BASE`. |

## Architecture

The renderer already has each asset's bytes (Cloud = a public Blob URL it can
fetch; Local = an object URL / file handle). OS-level operations need **real
files on disk**. Every native action funnels through one idea: **stage the
selected assets into a temp directory, then act on those real paths.** Cloud and
Local converge after staging; the only per-mode difference is how a spec gets its
bytes.

```
┌─────────────────────────── Electron app ───────────────────────────┐
│  Renderer (existing index.html, loaded via app:// protocol)         │
│    • detects window.electronAPI → enables native UI                 │
│    • on drag / copy / save, sends an "asset spec" list:             │
│        Cloud spec: { id, filename, url }    (main fetches it)        │
│        Local spec: { id, filename, bytes }  (renderer supplies)      │
│                          │ IPC (whitelisted channels)               │
│  ────────────────────────┼──────────────────────────────────────    │
│  Main process            ▼                                           │
│    • StagingManager: specs → os.tmpdir()/digitaldam-xxxx/           │
│        - Cloud: fetch(url) → write file                              │
│        - Local: write bytes → file                                  │
│    • NativeOps:                                                      │
│        - drag → webContents.startDrag({ files, icon })             │
│        - copy → clipboard write as file list                        │
│        - save → dialog.showOpenDialog(dir) → fs.copyFile            │
│    • cleans temp dir on window close                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

**`electron/main.js`** — App lifecycle; registers the `app://` scheme as
`standard` + `secure`; creates the `BrowserWindow` (`contextIsolation: true`,
`nodeIntegration: false`); serves the bundled `index.html`; wires IPC handlers;
cleans the temp dir on `window-all-closed`.

**`electron/preload.js`** — Exposes a typed `window.electronAPI` via
`contextBridge`: `{ apiBase, startDrag(specs), copyFiles(specs),
saveToFolder(specs) }`. No direct Node access in the renderer.

**`electron/staging.js`** — `StagingManager`: writes a spec list into a fresh
temp subfolder. Cloud specs are fetched in main; Local specs carry bytes.
Returns the on-disk file paths. Handles filename collisions and cleanup.

**`electron/native-ops.js`** — `startDrag` (`webContents.startDrag`),
`copyFiles` (clipboard as file list), `saveToFolder`
(`dialog.showOpenDialog` + `fs.copyFile`).

**Renderer bridge (in `index.html`)** — Feature-detects `window.electronAPI`.
When present: makes selected assets `draggable` and handles `dragstart`
(preventDefault + `startDrag`); routes `btnBulkCopy` to `copyFiles`; renders a
"Save to folder…" bulk-bar button wired to `saveToFolder`. When absent, the app
behaves exactly as today.

**API base shim** — `const API_BASE = window.electronAPI?.apiBase ?? '';`
prefixed onto the five `api*` helpers. Empty string (relative) in the browser —
unchanged behavior; the Vercel origin in Electron so Cloud `/api/*` resolves
under `app://`.

### IPC channels (whitelisted)

`stage-and-drag`, `stage-and-copy`, `stage-and-save`. Each receives a spec list,
stages files, and performs the corresponding native op.

## Data Flow — drag-out (representative)

1. User selects N assets; cards become `draggable` (Electron only).
2. `dragstart` → `e.preventDefault()`; renderer builds specs from
   `selectedAssetIds` (Cloud → `{url}`; Local → bytes read from the object URL).
3. `electronAPI.startDrag(specs)` → IPC `stage-and-drag`.
4. Main stages files into a fresh temp subfolder (fetch for Cloud, write bytes
   for Local).
5. Main calls `webContents.startDrag({ files, icon })`. Single-asset drag uses
   the same path, making it reliable too.

Copy and Save follow the same stage-first pattern, differing only in the final
native op.

## Secure Loading

Raw `file://` does not reliably provide a *secure context*, which
`showDirectoryPicker` (Local mode) and clipboard APIs require. `main.js`
registers a custom **`app://` scheme as `standard` + `secure`** and serves the
bundled `index.html` from it, so the page behaves as if served over `https://`
and Local mode + clipboard work with no frontend changes.

## Security Posture

- `contextIsolation: true`, `nodeIntegration: false`.
- Renderer touches only the typed `electronAPI` surface via `contextBridge`.
- Only the three whitelisted IPC channels are exposed.

## Project Structure

```
electron/
  main.js            # lifecycle, app:// protocol, BrowserWindow, IPC wiring
  preload.js         # window.electronAPI (contextBridge)
  staging.js         # StagingManager
  native-ops.js      # startDrag / copyFiles / saveToFolder
electron-builder.yml # macOS dmg target (arm64), unsigned
```

`index.html`, `api/`, and the Vercel deploy are unchanged except the renderer
bridge + the one-line `API_BASE` prefix.

`package.json` scripts:
- `npm run electron` — run the desktop app in dev (loads bundled `index.html`).
- `npm run dist` — build the double-clickable `.dmg`.

The existing `vercel` deploy flow is independent and unaffected.

## Edge Cases

- **Filename collisions / missing extension** — stage under a unique name from
  `id` + real `ext`; present the OS-facing filename as display name + ext.
- **Cloud download failure mid-stage** — abort the action, show the existing
  error toast, do not start a partial drag.
- **Large/many files** — Local bytes go over IPC; Cloud files fetched in main.
  Acceptable for images in v1; streaming is a future optimization.
- **Temp cleanup** — staging dir removed on `window-all-closed`; each action uses
  a fresh subfolder to avoid clashes between concurrent actions.
- **Drag latency** — staging is async, so `startDrag` fires right after files
  land; acceptable for v1.

## Risks (flagged, accepted for v1)

- `app://` secure-context support for `showDirectoryPicker` is the core
  assumption for Local-mode-in-Electron. **Validated in the first build** before
  building export features on top.
- Unsigned app triggers a Gatekeeper prompt on first open (expected).

## Verification Plan

1. **Smoke** — Electron launches, app loads, grid renders, **both Cloud and Local
   modes work** (validates `app://` + `API_BASE`).
2. **Drag-out** — select 3 assets → drag to Desktop → 3 real files (both modes).
3. **Copy as files** — select → Copy → paste in Finder → real files.
4. **Save to folder** — select → Save to folder… → pick dir → files copied.
5. **Web regression** — open `index.html` in Chrome → unchanged (copy =
   image/URL behavior, no Save button, no native drag).
6. **Packaging** — `npm run dist` produces a launchable `.dmg`.
