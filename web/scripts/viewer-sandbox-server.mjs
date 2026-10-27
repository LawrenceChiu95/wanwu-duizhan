// Usage: node scripts/viewer-sandbox-server.mjs <packDir> [port=4399]
// Serves a packed artifact with headers that approximate the Artifacts viewer sandbox (opaque origin, own files + listed CDNs only, no blob: fetch).
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
const [root, port = '4399'] = process.argv.slice(2);
const cdn = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh';
const csp = [`default-src 'none'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${cdn} https://cdn.tailwindcss.com https://code.jquery.com https://cdn.plot.ly`,
  `style-src 'self' 'unsafe-inline' ${cdn} https://fonts.googleapis.com`, `font-src 'self' data: ${cdn} https://fonts.gstatic.com`, `img-src 'self' data: blob: ${cdn}`,
  `connect-src 'self' data: ${cdn}`, `worker-src 'self' blob:`, `media-src 'self' data:`, `frame-src 'none'`, `object-src 'none'`, `sandbox allow-scripts`].join('; ');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.png': 'image/png'};
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, {'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Security-Policy': csp, 'Access-Control-Allow-Origin': '*'});
    res.end(body);
  } catch { res.writeHead(404); res.end('missing'); }
}).listen(Number(port), '127.0.0.1', () => console.log('csp server', port));
