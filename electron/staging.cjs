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
