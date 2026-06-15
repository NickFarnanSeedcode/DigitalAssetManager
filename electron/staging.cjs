// electron/staging.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');

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
