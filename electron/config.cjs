// electron/config.cjs
// The origin Cloud-mode /api/* calls are sent to when running under app://.
// Replace the fallback with your actual Vercel deployment domain.
const API_BASE = process.env.DAM_API_BASE || 'https://digitalassetmanager.vercel.app';

module.exports = { API_BASE };
