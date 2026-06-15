# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**DigitalAssetManager (DigitalDAM)** — a browser-based Digital Asset Manager built with vanilla HTML, CSS, and JavaScript, deployed on Vercel. Supports two storage modes: **Cloud** (Supabase + Vercel Blob) and **Local** (files and metadata stored on the user's machine via the File System Access API).

## Architecture

The project has two parts:

### Frontend — `index.html`
One self-contained file with three sections:

1. **`<style>`** — All CSS using custom properties defined on `:root`. The design is a dark navy theme (`--bg-primary: #0B0D1A`) with a teal accent (`--accent: #00D4A8`).

2. **`<body>`** — Static HTML for the topbar, main grid container, and the following modals/overlays (all use the `.overlay` + `.modal` pattern):
   - `#overlay` — Add / Edit asset modal
   - `#bulkOverlay` — Bulk tag modal (`.bulk-overlay` / `.bulk-modal` variant)
   - `#settingsOverlay` — App settings modal (placeholders; ready for real settings)
   - `#toast` — Toast notification
   Asset cards are generated dynamically via JS.

3. **`<script>`** — Vanilla JS organized into logical sections (marked with `/* ─── Section ─── */` comments):
   - **API layer** (`apiGetAll`, `apiCreate`, `apiUpdate`, `apiDelete`, `apiUploadFile`) — cloud-only fetch calls to `/api/` routes; never called directly from handlers — always go through the dispatcher
   - **Local Storage API** — IndexedDB wrapper (`localDB`), `dam_data.json` read/write (`localReadManifest`, `localWriteManifest`), and local CRUD functions (`localGetAll`, `localCreate`, `localUpdate`, `localDelete`, `localCopyFile`, `localResolveObjectURLs`)
   - **API Dispatchers** (`dispatchGetAll`, `dispatchUploadFile`, `dispatchCreate`, `dispatchUpdate`, `dispatchDelete`) — route each operation to the cloud API or local functions based on `storageMode`; all handlers use these, never the raw `api*` functions directly
   - **State** — `allAssets[]` (canonical records), `displayAssets[]` (local mode only: same records but with `blobUrl` replaced by ephemeral `blob:` object URLs for rendering), `currentTags[]`, `selectedFiles[]`, `editingId`, `sortAsc` (boolean, default `true`), `storageMode` ("cloud"|"local"), `localDirHandle` (FileSystemDirectoryHandle)
   - **Search** — live filters the appropriate source array on `input` event (`displayAssets` in local mode, `allAssets` in cloud); includes a clear button (`#btnClearSearch`)
   - **Sort** — `#btnSort` toggles `sortAsc`; `sortedAssets(assets)` sorts by name before render; dispatches a synthetic `input` event to re-apply the current search filter
   - **Render** — `renderGrid(assets, query)` sorts via `sortedAssets()` then rebuilds the grid innerHTML; calls `initGifObserver()` after every render; the `total` count always reads `allAssets.length`
   - **GIF observer** — `initGifObserver()` sets up an `IntersectionObserver` to swap `img.src` between `data-static` (thumbnail) and `data-gif` (blobUrl) as cards enter/leave the viewport
   - **Modal** — open/close helpers, drag-and-drop file handling, tag chip input system; supports multi-file selection
   - **Save / Edit / Delete** — async handlers that call the dispatchers then re-render from the correct source array; save loops through `selectedFiles[]` sequentially when multiple files are queued
   - **Edit preview** — `showEditPreview(asset)` uses `asset.blobUrl` to inject the appropriate element; in local mode, `editAsset()` sources the asset from `displayAssets` (which has the object URL) rather than `allAssets`
   - **Settings** — `syncSettingsUI()` keeps the toggle buttons and folder row in sync with state; `setStorageMode(mode)` handles switching with folder picker and grid reload; `chooseLocalFolder()` calls `showDirectoryPicker` and persists the handle; `reloadAssetsForMode()` revokes old object URLs and re-fetches
   - **Thumbnail generation** — `makeThumbnail(file)` uses a Canvas to resize images to 480px max, stored as WebP; captures the first frame of GIFs; non-images resolve `null`

### Backend — `api/`

Vercel serverless functions (Node.js, ES modules):

- **`api/upload.js`** — `POST` — receives a raw file binary stream, uploads it to Vercel Blob at `files/{id}.{ext}`, returns `{ url }`. Requires headers: `x-asset-id`, `x-filename`, `Content-Type`. Body parsing is disabled (`config.api.bodyParser = false`).
- **`api/assets.js`** — `GET` returns the full asset list from Supabase ordered by `date_added` desc; `POST` inserts a new asset row.
- **`api/asset/[id].js`** — `PATCH` updates `name`/`tags` for an asset; `DELETE` removes the row from Supabase and deletes its file from Vercel Blob.
- **`api/suggest-tags.js`** — `POST` — accepts `{ thumbnail, filename, fileType }`. For images, calls Google Cloud Vision `LABEL_DETECTION` and returns labels with score ≥ 0.7 as tag suggestions. For non-image files, derives basic tags from the filename and MIME type locally without an external call.

### Storage

Two modes, selectable in Settings → Storage. Switching modes does not migrate assets between stores.

**Cloud mode** (default):
- **Supabase (Postgres)** — `assets` table holds all asset metadata. Columns use snake_case (`file_type`, `file_size`, `blob_url`, `date_added`); the API layer maps these to camelCase for the frontend.
- **Vercel Blob** — `files/{id}.{ext}` — the actual uploaded file for each asset.

**Local mode**:
- **Designated folder** (user-selected via `showDirectoryPicker`) — files are stored as `{id}.{ext}` directly in this folder.
- **`dam_data.json`** — lives in the same folder; contains `{ assets: [...] }` with the full asset records. The `blobUrl` field stores the filename (`{id}.{ext}`) rather than a remote URL.
- **Folder handle persistence** — the `FileSystemDirectoryHandle` is stored in IndexedDB (`DigitalDAM` database, `handles` store) so the folder survives page reloads. On reload, the browser re-prompts for permission; if denied, the app falls back to Cloud mode automatically.
- **Object URLs** — on load, each local file is read and wrapped in a `blob:` object URL via `localResolveObjectURLs()`. These live in `displayAssets[]` (a mirror of `allAssets[]` with only `blobUrl` swapped). Object URLs are revoked on mode switch, on delete, and on `beforeunload`.
- **Browser requirement** — Local mode requires Chrome or Edge (File System Access API). The Local toggle is disabled on unsupported browsers.

## Key Data Shape

```js
{
  id:        String,        // crypto.randomUUID()
  name:      String,        // display name (not necessarily filename)
  tags:      String[],      // lowercase
  ext:       String,        // lowercase file extension
  fileType:  String,        // MIME type
  fileSize:  Number,        // bytes
  thumbnail: String | null, // base64 WebP data URL — first-frame static for GIFs
  blobUrl:   String,        // Cloud: Vercel Blob public URL; Local: filename "{id}.{ext}"
  dateAdded: Number         // Date.now()
}
```

In local mode, `displayAssets[]` is a parallel array where `blobUrl` is replaced by an ephemeral `blob:` object URL for rendering, and the original filename is preserved in `_localFilename`. Always read/write `allAssets` for business logic; only pass `displayAssets` to `renderGrid` and `showEditPreview`.

## GIF Handling

GIFs use two sources:

- **`thumbnail`** (base64 WebP) — static first-frame snapshot generated client-side by `makeThumbnail` at save time; used as the card placeholder while the card is off-screen
- **`blobUrl`** — the Vercel Blob public URL for the original GIF; used as the live animated src when the card is in view

The `IntersectionObserver` in `initGifObserver()` swaps `img.src` between `data-static` (thumbnail) and `data-gif` (blobUrl) based on viewport visibility.

## Edit Modal Preview

`showEditPreview(asset)` fires when opening edit mode. It uses `asset.blobUrl` to render a preview. In local mode, `editAsset(id)` sources the asset from `displayAssets` (which has the object URL) so the preview works correctly. Renders:
- **Images / GIFs** → `<img>` (GIFs animate in the preview)
- **Video** → `<video controls loop>`
- **Audio** → `<audio controls>`
- **Other** → file info fallback, no preview

The modal gains `.has-preview` (max-width: 700px) when a previewable file is shown.

## AI Tag Suggestions

`api/suggest-tags.js` powers the tag suggestion chips shown in the add/edit modal.

- **Add mode**: suggestions fire automatically when files are selected. For multi-file uploads, the first image in the batch (or first file if none are images) is used as the source.
- **Edit mode**: suggestions fire the first time the user clicks into the tags field (`focus` event on the tag input). Uses the stored `asset.thumbnail` — no re-upload needed. A `suggestionsFetched` flag prevents re-fetching within the same modal session.
- **Source**: Google Cloud Vision `LABEL_DETECTION` for images (labels filtered to score ≥ 0.7). Non-image files get tags derived locally from filename/MIME type.

## Multi-File Upload

The add modal accepts multiple files via the file input (`multiple` attribute) or drag-and-drop.

- **1 file**: existing UX — file banner, asset name field, suggestions from that file.
- **2+ files**: file name field is hidden (each asset is named from its filename), a scrollable file list replaces the banner, the save button reads "Save N Assets", and suggestions are fetched from the first image in the batch. Tags entered apply to all files.
- Files are uploaded and saved sequentially; the button shows "Uploading 2 of 5…" progress.

## Environment Variables

- **`BLOB_READ_WRITE_TOKEN`** — Vercel Blob read/write token. Set in Vercel project settings (auto-injected at runtime). For local dev, add to `.env.local`.
- **`SUPABASE_URL`** — Supabase project URL (Settings → API → Project URL).
- **`SUPABASE_SERVICE_KEY`** — Supabase service role key (Settings → API → Project API keys). Used server-side only; never exposed to the frontend.
- **`GOOGLE_CLOUD_VISION_API_KEY`** — Google Cloud Vision API key. Used by `api/suggest-tags.js` for image label detection. Must have the Cloud Vision API enabled in the Google Cloud project.

## Local Development

```
vercel dev
```

Runs the frontend and API routes locally with environment variables injected from Vercel.

## Deployment

```
vercel --prod
```

Must be run from the `FirstProject/` directory.

## UI Patterns & Design System

### Colors
All colors are CSS custom properties on `:root`. Key values:
- `--accent: #00D4A8` (teal) — primary actions, focus rings, highlights
- `--bg-primary / --bg-secondary / --bg-card` — page → surface → card (darkest to lightest)
- `--border / --border-light` — subtle → visible borders
- `--text-primary / --text-secondary / --text-muted` — full → dimmed → ghost text
- `--danger: #FF4D6A` — destructive actions only

### Icons
All icons are **inline SVGs** in Feather icon style — no external icon library. Use `stroke-width="2"` (detail icons) or `stroke-width="2.5–3"` (small/bold icons), always with `stroke-linecap="round" stroke-linejoin="round"`. Common icons are available as JS helper functions: `svgGrid()`, `svgSearch()`, `svgFile()`, `svgCheck()`, `svgTrash()`.

### Buttons
| Class | Use | Style |
|---|---|---|
| `.btn-add` | Primary action (teal fill) | `--accent` bg, dark text, 40px tall |
| `.btn-settings` | Icon-only secondary | `--bg-secondary` bg, `--border` border, 40×40px |
| `.btn-save` | Modal confirm | Same as `.btn-add` |
| `.btn-cancel` | Modal cancel / secondary | `--bg-secondary` bg, `--border` border |
| `.btn-sort` | Toolbar toggle | `--bg-card` bg, `--border` border, 34px |
| `.close-btn` | Modal X close | `--bg-secondary` bg, 32×32px, 8px radius |
| `.btn-bulk` | Bulk action bar | `--bg-secondary` bg; add `.danger` for destructive |

All interactive buttons include `transition` for background, transform, and box-shadow. Hover states use `translateY(-1px)` lift.

### Modal Pattern
Every modal follows the same structure and CSS classes:

```html
<div class="overlay" id="myOverlay">          <!-- fixed full-screen backdrop -->
  <div class="modal">
    <div class="modal-head">
      <span class="modal-title">Title</span>
      <button class="close-btn" id="btnCloseMyModal"><!-- X svg --></button>
    </div>
    <!-- content -->
    <div class="modal-foot">
      <button class="btn-cancel">Cancel</button>
      <button class="btn-save">Save</button>
    </div>
  </div>
</div>
```

Open/close by toggling `.open` on the overlay element. Always wire up: close button, cancel button, overlay-click (`e.target === overlay`), and Escape key.

### Settings Modal
`#settingsOverlay` — open via `openSettingsModal()` (which calls `syncSettingsUI()` first), close via `closeSettingsModal()`. Contains `.settings-row` rows organized under `.settings-section-label` headers.

**Storage section** (implemented):
- Cloud/Local toggle — `.storage-mode-btn` buttons with `.active` class on the current mode
- `#localFolderRow` — shown only in local mode; displays folder name and a "Choose Folder" button
- `syncSettingsUI()` keeps toggle state in sync with the `storageMode` variable

**General / Display sections** — still contain `.settings-placeholder` badges ("Coming soon"). When implementing, replace the badge with the actual control.

### Form Elements
- `.form-group` + `.form-label` + `.form-input` — standard labeled input
- `.tag-wrap` + `.tag-field` — tag chip input container
- `.tag-chip` — individual tag pill (appended dynamically)
- Focus state: `--accent` border + 3px `--accent-muted` outline ring

### JS Utility
`$('id')` is a shorthand for `document.getElementById('id')` defined at the top of the script. Use it throughout — don't use `querySelector` for ID lookups.

## Known Constraints

- **Thumbnail size**: Thumbnails are stored as base64 in the `thumbnail` column. Large collections may produce a sizeable Supabase response payload.
- **Edit modal**: Intentionally does not allow re-uploading a file — only name and tags are editable. Multi-file selection is not available in edit mode (one asset at a time).
- **Tag normalization**: All tags are lowercased on entry (`addTag` function).
- **Local mode browser support**: Requires Chrome or Edge (File System Access API). The Local toggle is automatically disabled on unsupported browsers.
- **Local mode — no migration**: Switching between Cloud and Local modes starts fresh in the new store. Assets from the previous mode are not transferred.
- **Local mode — permission on reload**: The browser may require the user to re-grant folder access after a page reload. If permission is denied, the app silently falls back to Cloud mode.
- **AI tag suggestions in local mode**: `apiSuggestTags` always calls the cloud endpoint regardless of storage mode — an internet connection is still required for AI suggestions.
