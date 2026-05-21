// Serveur statique minimal pour tester le site en local.
// Usage : node tools/dev-server.mjs  (port 8000 par défaut)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PORT = +process.env.PORT || 8000;

const MIME = {
    '.html':'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js':  'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg':'image/jpeg',
    '.webp':'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
    try {
        let path = decodeURIComponent(req.url.split('?')[0]);
        if (path === '/' || path === '') path = '/index.html';
        const full = normalize(join(ROOT, path));
        if (!full.startsWith(ROOT + sep) && full !== ROOT) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        const s = await stat(full).catch(() => null);
        const target = s?.isDirectory() ? join(full, 'index.html') : full;
        const data = await readFile(target);
        res.writeHead(200, {
            'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    } catch (err) {
        if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(500); res.end(String(err)); }
    }
}).listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}/`));
