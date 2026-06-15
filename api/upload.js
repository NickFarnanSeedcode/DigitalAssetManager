import { put } from '@vercel/blob';

// Disable Vercel's automatic body parsing so we can stream the raw file bytes
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const id          = req.headers['x-asset-id'];
    const filename    = req.headers['x-filename'] || 'file';
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const ext         = (filename.split('.').pop() || 'bin').toLowerCase();

    if (!id) {
        return res.status(400).json({ error: 'Missing x-asset-id header' });
    }

    try {
        const { url } = await put(`files/${id}.${ext}`, req, {
            access:          'public',
            addRandomSuffix: false,
            contentType,
        });

        return res.status(200).json({ url });
    } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: 'Upload failed' });
    }
}
