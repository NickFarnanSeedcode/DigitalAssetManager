// electron/native-ops.cjs
const { clipboard, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// macOS requires startDrag's icon to be a non-empty image or it throws.
// A 1x1 transparent PNG satisfies that without drawing a visible cursor badge.
// Built lazily so requiring this module under plain Node (tests, where
// require('electron') is a path string) doesn't touch nativeImage.
let _fallbackDragIcon = null;
function fallbackDragIcon() {
  if (!_fallbackDragIcon) {
    _fallbackDragIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    );
  }
  return _fallbackDragIcon;
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

// Start a native drag of real files out to Finder/desktop.
function startDrag(webContents, paths, icon) {
  if (!paths.length) return;
  const dragIcon = icon && !icon.isEmpty() ? icon : fallbackDragIcon();
  webContents.startDrag({ files: paths, icon: dragIcon });
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
