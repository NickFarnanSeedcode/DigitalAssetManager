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
