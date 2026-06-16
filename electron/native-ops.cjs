// electron/native-ops.cjs
const { clipboard, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// startDrag's icon must be a real, non-empty image or the OS silently declines
// the drag. macOS exposes a named system icon; on other platforms we fall back
// to the bundled app icon. Built lazily and cached so requiring this module
// under plain Node (tests, where require('electron') is a path string) doesn't
// touch nativeImage.
let _defaultDragIcon = null;
function defaultDragIcon() {
  if (!_defaultDragIcon) {
    if (process.platform === 'darwin') {
      _defaultDragIcon = nativeImage.createFromNamedImage('NSImageNameMultipleDocuments');
    } else {
      _defaultDragIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
    }
  }
  return _defaultDragIcon;
}

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

// Build a Windows CF_HDROP DROPFILES buffer so Explorer pastes real files.
// Layout: 20-byte DROPFILES header (pFiles=20, pt=0,0, fNC=0, fWide=1), then
// UTF-16LE NUL-terminated paths, then an extra UTF-16LE NUL as list terminator.
function buildDropfilesBuffer(paths) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0);
  header.writeUInt32LE(1, 16);
  const list = paths.map((p) => Buffer.from(p + '\0', 'utf16le'));
  const terminator = Buffer.from('\0', 'utf16le');
  return Buffer.concat([header, ...list, terminator]);
}

// Start a native drag of real files out to Finder/desktop.
function startDrag(webContents, paths, icon) {
  if (!paths.length) return;
  const dragIcon = icon && !icon.isEmpty() ? icon : defaultDragIcon();
  webContents.startDrag({ files: paths, icon: dragIcon });
}

// Put real files on the system clipboard so a Finder/Explorer paste produces files.
function copyFiles(paths) {
  if (!paths.length) return 0;
  if (process.platform === 'win32') {
    clipboard.writeBuffer('CF_HDROP', buildDropfilesBuffer(paths));
  } else {
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(buildFilenamesPlist(paths), 'utf8'));
  }
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

module.exports = { buildFilenamesPlist, buildDropfilesBuffer, startDrag, copyFiles, saveToFolder };
