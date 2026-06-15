import { createClient } from '@supabase/supabase-js';
import { del } from '@vercel/blob';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    const { id } = req.query;

    if (req.method === 'PATCH') {
        const { name, tags } = req.body;

        const { data, error } = await supabase
            .from('assets')
            .update({ name, tags })
            .eq('id', id)
            .select()
            .single();

        if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });

        return res.status(200).json({
            id:        data.id,
            name:      data.name,
            tags:      data.tags ?? [],
            ext:       data.ext,
            fileType:  data.file_type,
            fileSize:  data.file_size,
            thumbnail: data.thumbnail,
            blobUrl:   data.blob_url,
            dateAdded: data.date_added,
        });
    }

    if (req.method === 'DELETE') {
        const { data, error } = await supabase
            .from('assets')
            .delete()
            .eq('id', id)
            .select('blob_url')
            .single();

        if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });

        if (data?.blob_url) {
            try { await del(data.blob_url); } catch (e) { console.error('Blob delete failed:', e); }
        }

        return res.status(204).end();
    }

    res.status(405).end();
}
