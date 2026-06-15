// electron/native-ops.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFilenamesPlist } = require('./native-ops.cjs');

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
