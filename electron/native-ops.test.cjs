// electron/native-ops.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFilenamesPlist, buildDropfilesBuffer } = require('./native-ops.cjs');

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

test('buildDropfilesBuffer writes a DROPFILES header with fWide=1 and UTF-16LE paths', () => {
  const buf = buildDropfilesBuffer(['C:\\a.png', 'C:\\b.jpg']);
  assert.equal(buf.readUInt32LE(0), 20, 'pFiles offset is 20');
  assert.equal(buf.readUInt32LE(16), 1, 'fWide is TRUE');
  const list = buf.slice(20).toString('utf16le');
  assert.equal(list, 'C:\\a.png\x00C:\\b.jpg\x00\x00');
});
