// electron/suggest-tags.cjs
// Mirrors api/suggest-tags.js so Electron can call Google Vision directly
// with the user's own API key (bypassing CORS and our Vercel quota).
// Pure-ish: fetch is injected for testability.

function toTag(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

// Non-image fallback — derive tags from filename + MIME. No network.
function filenameTags(filename, fileType) {
  const name = (filename || '').replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').toLowerCase();
  const ext = (filename || '').split('.').pop().toLowerCase();
  const typeTag = fileType?.split('/')[0];
  return [...new Set([typeTag, ext, ...name.split(' ')]
    .filter((t) => t && t.length > 1)
    .map((t) => t.trim().replace(/[^a-z0-9_-]/g, ''))
    .filter((t) => t.length > 0)
  )].slice(0, 8);
}

// Hit Google Vision LABEL_DETECTION + WEB_DETECTION with the given key.
// Returns suggestions[] (possibly empty); throws on HTTP/network error.
async function visionTags({ key, thumbnail, fetchFn = fetch }) {
  const base64Data = thumbnail.slice(thumbnail.indexOf(',') + 1);
  const r = await fetchFn(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Data },
          features: [
            { type: 'LABEL_DETECTION', maxResults: 15 },
            { type: 'WEB_DETECTION', maxResults: 10 },
          ],
        }],
      }),
    }
  );
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const err = new Error(`Vision API ${r.status}: ${text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const response = data?.responses?.[0] ?? {};
  const labels = response.labelAnnotations ?? [];
  const entities = response.webDetection?.webEntities ?? [];

  const webTags = entities
    .filter((e) => e.score >= 0.5 && e.description)
    .map((e) => toTag(e.description))
    .filter((t) => t.length > 1);

  const labelTags = labels
    .filter((l) => l.score >= 0.7)
    .map((l) => toTag(l.description))
    .filter((t) => t.length > 1);

  return [...new Set([...webTags, ...labelTags])].slice(0, 12);
}

// Top-level dispatcher used by main: image → Vision, otherwise filename fallback.
async function suggestTags({ key, thumbnail, filename, fileType, fetchFn }) {
  if (!thumbnail?.startsWith('data:image/')) {
    return { suggestions: filenameTags(filename, fileType) };
  }
  if (!key) {
    return { suggestions: [], reason: 'no-key' };
  }
  try {
    const suggestions = await visionTags({ key, thumbnail, fetchFn });
    return { suggestions };
  } catch (err) {
    return { suggestions: [], reason: 'error', error: err.message };
  }
}

// Tiny 1x1 PNG used by the Settings "Test" button to verify a key without
// burning meaningful quota — Vision still bills per request, but the payload
// is minimal and the round-trip confirms auth works.
const TEST_THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function testKey({ key, fetchFn = fetch }) {
  try {
    await visionTags({ key, thumbnail: TEST_THUMBNAIL, fetchFn });
    return { ok: true };
  } catch (err) {
    return { ok: false, status: err.status ?? null, error: err.message };
  }
}

module.exports = { filenameTags, visionTags, suggestTags, testKey, TEST_THUMBNAIL };
