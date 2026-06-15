export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const key = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    if (!key) return res.status(500).json({ error: 'GOOGLE_CLOUD_VISION_API_KEY not configured' });

    const { thumbnail, filename, fileType } = req.body;

    // Vision API only works on images — for non-image files derive tags from filename/type
    if (!thumbnail?.startsWith('data:image/')) {
        const name = (filename || '').replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').toLowerCase();
        const ext  = (filename || '').split('.').pop().toLowerCase();
        const typeTag = fileType?.split('/')[0]; // "audio", "video", etc.
        const suggestions = [...new Set([typeTag, ext, ...name.split(' ')]
            .filter(t => t && t.length > 1)
            .map(t => t.trim().replace(/[^a-z0-9_-]/g, ''))
            .filter(t => t.length > 0)
        )].slice(0, 8);
        return res.status(200).json({ suggestions });
    }

    const base64Data = thumbnail.slice(thumbnail.indexOf(',') + 1);

    try {
        const r = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: [{
                        image: { content: base64Data },
                        features: [
                            { type: 'LABEL_DETECTION', maxResults: 15 },
                            { type: 'WEB_DETECTION',   maxResults: 10 },
                        ],
                    }],
                }),
            }
        );

        if (!r.ok) {
            console.error('Cloud Vision error:', r.status, await r.text());
            return res.status(200).json({ suggestions: [] });
        }

        const data     = await r.json();
        const response = data?.responses?.[0] ?? {};
        const labels   = response.labelAnnotations  ?? [];
        const entities = response.webDetection?.webEntities ?? [];

        const toTag = s => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

        const webTags   = entities
            .filter(e => e.score >= 0.5 && e.description)
            .map(e => toTag(e.description))
            .filter(t => t.length > 1);

        const labelTags = labels
            .filter(l => l.score >= 0.7)
            .map(l => toTag(l.description))
            .filter(t => t.length > 1);

        const suggestions = [...new Set([...webTags, ...labelTags])].slice(0, 12);

        return res.status(200).json({ suggestions });
    } catch (err) {
        console.error('suggest-tags error:', err);
        return res.status(200).json({ suggestions: [] });
    }
}
