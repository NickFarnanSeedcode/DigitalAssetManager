// electron/native-ops.cjs
const { clipboard, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// macOS requires startDrag's icon to be a real, non-empty image — a degenerate
// or transparent icon makes the OS silently decline to start the drag. Use the
// system multi-document icon. Built lazily and cached so requiring this module
// under plain Node (tests, where require('electron') is a path string) doesn't
// touch nativeImage.
let _defaultDragIcon = null;
function defaultDragIcon() {
  if (!_defaultDragIcon) {
    _defaultDragIcon = nativeImage.createFromNamedImage('NSImageNameMultipleDocuments');
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

// Start a native drag of real files out to Finder/desktop.
function startDrag(webContents, paths, icon) {
  if (!paths.length) return;
  const dragIcon = icon && !icon.isEmpty() ? icon : defaultDragIcon();
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
