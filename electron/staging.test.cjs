// electron/staging.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeFilename } = require('./staging.cjs');

test('safeFilename sanitizes path-unsafe characters', () => {
  const used = new Set();
  assert.equal(safeFilename({ id: 'a', filename: 'a/b:c*.png' }, used), 'a_b_c_.png');
});

test('safeFilename falls back to id when filename is empty', () => {
  const used = new Set();
  assert.equal(safeFilename({ id: 'xyz', filename: '' }, used), 'xyz');
});

test('safeFilename appends a counter before the extension on collision', () => {
  const used = new Set();
  const first  = safeFilename({ id: 'a', filename: 'photo.jpg' }, used);
  const second = safeFilename({ id: 'b', filename: 'photo.jpg' }, used);
  assert.equal(first, 'photo.jpg');
  assert.equal(second, 'photo (1).jpg');
});
