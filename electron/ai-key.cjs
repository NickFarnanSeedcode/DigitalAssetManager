// electron/ai-key.cjs
// Persists the user's Google Cloud Vision API key encrypted via Electron's
// safeStorage (OS keychain on macOS/Windows). Stored at userData/vision-key.enc.
// The renderer never sees the raw key — only "is one stored?" and "did the
// stored one work?".
const { app, safeStorage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function keyPath() {
  return path.join(app.getPath('userData'), 'vision-key.enc');
}

function hasKey() {
  return fs.existsSync(keyPath());
}

async function readKey() {
  if (!hasKey()) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable; cannot decrypt stored key');
  }
  const buf = await fsp.readFile(keyPath());
  return safeStorage.decryptString(buf);
}

async function writeKey(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.trim()) {
    throw new Error('Empty key');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable; cannot store key');
  }
  const buf = safeStorage.encryptString(plaintext.trim());
  await fsp.writeFile(keyPath(), buf);
}

async function clearKey() {
  try {
    await fsp.unlink(keyPath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { hasKey, readKey, writeKey, clearKey };
