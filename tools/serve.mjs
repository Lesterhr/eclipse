/**
 * Minimaler statischer Server zum Ausprobieren. Ohne Abhängigkeiten.
 *
 *   node tools/serve.mjs [port]
 *
 * Wichtig: Kamera und Standort geben Browser nur in einem sicheren Kontext frei.
 * Das ist entweder HTTPS oder localhost. Vom Handy aus über die LAN-Adresse
 * funktioniert die Messung deshalb NICHT — dafür braucht es echtes HTTPS
 * (GitHub Pages, ein Tunnel, oder ein selbst signiertes Zertifikat).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    // Kein Ausbruch aus dem Projektordner
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('directory');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('nicht gefunden');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`\n  http://localhost:${port}\n`);
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  im Netz: http://${a.address}:${port}  (${name})`);
      }
    }
  }
  console.log('\n  Kamera und Standort brauchen localhost oder HTTPS.\n');
});
