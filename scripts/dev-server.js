// Local preview: serves public/ and runs the api/ functions the same way the host does.
// Usage: node scripts/dev-server.js [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = +process.argv[2] || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
      const file = path.join(root, 'api', name + '.js');
      if (!existsSync(file)) { res.statusCode = 404; return res.end('no such function'); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(pub, rel);
    if (!file.startsWith(pub) || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.statusCode = 500;
    res.end(String(e?.stack || e));
  }
}).listen(port, () => console.log(`Trading Mastery dev server: http://localhost:${port}`));
