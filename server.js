import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT || 8787);
const token = process.env.NETLIFY_AUTH_TOKEN;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.disable('x-powered-by');
app.use(cors({ origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error('Origin tidak diizinkan oleh ALLOWED_ORIGINS'));
}}));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
app.get('/health', (_req, res) => res.json({ service: 'Vall Hansome Deploy API', providers: token ? ['Netlify'] : [], configured: Boolean(token) }));

app.post('/api/deploy/netlify', upload.single('siteZip'), async (req, res) => {
  try {
    if (!token) return res.status(503).json({ error: 'Backend belum dikonfigurasi. Atur NETLIFY_AUTH_TOKEN di environment server.' });
    if (!req.file) return res.status(400).json({ error: 'File ZIP website wajib dipilih.' });
    if (!req.file.originalname.toLowerCase().endsWith('.zip')) return res.status(400).json({ error: 'File harus berformat ZIP.' });
    const rawName = String(req.body.siteName || 'vall-hansome-' + Date.now()).toLowerCase();
    const siteName = rawName.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'vall-hansome-' + Date.now();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let siteResp = await fetch('https://api.netlify.com/api/v1/sites', { method: 'POST', headers, body: JSON.stringify({ name: siteName }) });
    let site = await siteResp.json().catch(() => ({}));
    if (!siteResp.ok && siteResp.status === 422) {
      siteResp = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteName)}`, { headers: { Authorization: `Bearer ${token}` } });
      site = await siteResp.json().catch(() => ({}));
    }
    if (!siteResp.ok) return res.status(siteResp.status).json({ error: site.message || site.error || 'Gagal membuat atau menemukan site Netlify.' });
    if (!site.id) return res.status(502).json({ error: 'Netlify tidak mengembalikan ID site.' });
    const deployResp = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site.id)}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
      body: req.file.buffer
    });
    const deploy = await deployResp.json().catch(() => ({}));
    if (!deployResp.ok) return res.status(deployResp.status).json({ error: deploy.message || deploy.error || 'Netlify menolak ZIP. Pastikan ZIP berisi index.html di root.' });
    res.json({ ok: true, siteId: site.id, deployId: deploy.id, url: deploy.ssl_url || deploy.url || site.ssl_url || site.url });
  } catch (err) {
    res.status(500).json({ error: 'Kesalahan backend: ' + (err?.message || 'tidak diketahui') });
  }
});
app.listen(port, '0.0.0.0', () => console.log(`Vall Hansome Deploy API listening on ${port}`));
