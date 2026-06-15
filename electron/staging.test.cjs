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

const fs = require('node:fs');
const { stage } = require('./staging.cjs');

test('stage writes Local-mode bytes specs to disk', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const { dir, paths } = await stage([{ id: 'a', filename: 'a.bin', bytes }]);
  assert.equal(paths.length, 1);
  assert.deepEqual([...fs.readFileSync(paths[0])], [1, 2, 3, 4]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stage fetches Cloud-mode url specs via injected fetch', async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([9, 9]).buffer,
  });
  const { dir, paths } = await stage(
    [{ id: 'a', filename: 'a.png', url: 'https://x/a.png' }],
    { fetch: fakeFetch },
  );
  assert.deepEqual([...fs.readFileSync(paths[0])], [9, 9]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stage throws when a fetch fails', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => stage([{ id: 'a', filename: 'a.png', url: 'https://x/a.png' }], { fetch: fakeFetch }),
    /404/,
  );
});

test('stage gives colliding names distinct files', async () => {
  const b = new Uint8Array([0]);
  const { dir, paths } = await stage([
    { id: 'a', filename: 'p.jpg', bytes: b },
    { id: 'b', filename: 'p.jpg', bytes: b },
  ]);
  assert.equal(new Set(paths).size, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
