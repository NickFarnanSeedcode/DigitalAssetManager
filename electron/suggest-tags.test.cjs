// electron/suggest-tags.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filenameTags, suggestTags } = require('./suggest-tags.cjs');

test('filenameTags derives tags from filename and MIME', () => {
  const tags = filenameTags('hero_image_final.png', 'image/png');
  assert.ok(tags.includes('image'));
  assert.ok(tags.includes('png'));
  assert.ok(tags.includes('hero'));
  assert.ok(tags.includes('final'));
});

test('filenameTags drops short tokens and dedupes', () => {
  const tags = filenameTags('a-b-cat.mp3', 'audio/mpeg');
  assert.ok(!tags.includes('a'));
  assert.ok(!tags.includes('b'));
  assert.ok(tags.includes('cat'));
  assert.ok(tags.includes('audio'));
  assert.ok(tags.includes('mp3'));
  assert.equal(new Set(tags).size, tags.length);
});

test('suggestTags falls back to filename tags for non-image input (no key needed)', async () => {
  const res = await suggestTags({
    key: null,
    thumbnail: 'data:application/pdf;base64,AAAA',
    filename: 'report_q3.pdf',
    fileType: 'application/pdf',
  });
  assert.ok(res.suggestions.includes('report'));
  assert.ok(res.suggestions.includes('pdf'));
});

test('suggestTags returns no-key reason for image input without a key', async () => {
  const res = await suggestTags({
    key: null,
    thumbnail: 'data:image/png;base64,AAAA',
    filename: 'x.png',
    fileType: 'image/png',
  });
  assert.deepEqual(res.suggestions, []);
  assert.equal(res.reason, 'no-key');
});

test('suggestTags calls injected fetch with the key and parses Vision response', async () => {
  let capturedUrl = null;
  const fakeFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      json: async () => ({
        responses: [{
          labelAnnotations: [
            { description: 'Cat', score: 0.95 },
            { description: 'Mammal', score: 0.8 },
            { description: 'LowConfidence', score: 0.5 },
          ],
          webDetection: {
            webEntities: [
              { description: 'Kitten', score: 0.9 },
              { description: 'Lowscore', score: 0.3 },
            ],
          },
        }],
      }),
    };
  };
  const res = await suggestTags({
    key: 'AIzaTEST',
    thumbnail: 'data:image/png;base64,AAAA',
    filename: 'cat.png',
    fileType: 'image/png',
    fetchFn: fakeFetch,
  });
  assert.match(capturedUrl, /key=AIzaTEST/);
  assert.ok(res.suggestions.includes('cat'));
  assert.ok(res.suggestions.includes('mammal'));
  assert.ok(res.suggestions.includes('kitten'));
  assert.ok(!res.suggestions.includes('lowconfidence'));
  assert.ok(!res.suggestions.includes('lowscore'));
});

test('suggestTags returns error reason when Vision call fails', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  const res = await suggestTags({
    key: 'bad',
    thumbnail: 'data:image/png;base64,AAAA',
    filename: 'x.png',
    fileType: 'image/png',
    fetchFn: fakeFetch,
  });
  assert.deepEqual(res.suggestions, []);
  assert.equal(res.reason, 'error');
  assert.match(res.error, /403/);
});
