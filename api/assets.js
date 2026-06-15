import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('assets')
            .select('*')
            .order('date_added', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        // Map snake_case columns back to camelCase for the frontend
        const assets = data.map(row => ({
            id:        row.id,
            name:      row.name,
            tags:      row.tags ?? [],
            ext:       row.ext,
            fileType:  row.file_type,
            fileSize:  row.file_size,
            thumbnail: row.thumbnail,
            blobUrl:   row.blob_url,
            dateAdded: row.date_added,
        }));

        return res.status(200).json(assets);
    }

    if (req.method === 'POST') {
        const asset = req.body;
        if (!asset || !asset.id) {
            return res.status(400).json({ error: 'Invalid asset data' });
        }

        const { error } = await supabase.from('assets').insert({
            id:         asset.id,
            name:       asset.name,
            tags:       asset.tags ?? [],
            ext:        asset.ext,
            file_type:  asset.fileType,
            file_size:  asset.fileSize,
            thumbnail:  asset.thumbnail,
            blob_url:   asset.blobUrl,
            date_added: asset.dateAdded,
        });

        if (error) return res.status(500).json({ error: error.message });

        return res.status(201).json(asset);
    }

    res.status(405).end();
}
