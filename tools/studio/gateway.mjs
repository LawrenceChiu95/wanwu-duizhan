import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {gzipSync} from 'node:zlib';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2'};
function end(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'});
  res.end(JSON.stringify(value));
}
function headers(input) {
  const skip = new Set(['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...String(input.connection ?? '').split(',').map(s => s.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !skip.has(name)));
}

// The external platform terminates TLS. Both internal listeners are loopback;
// only /~!frp may upgrade, and all API requests have one fixed destination.
export function createGateway({publicOrigin, webRoot = null, apiPort = 7001, frpPort = 7000, tls = null}) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw Error('Exact HTTPS public origin required');
  const sockets = new Set();
  const handler = async (req, res) => {
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return end(res, 400, {error: 'bad-request'});
      const url = new URL(req.url, publicOrigin), route = url.pathname;
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('x-content-type-options', 'nosniff');
      if (route === '/_health' && req.method === 'GET') return end(res, 200, {service: 'wanwu-studio', role: 'transport-only'});
      if (route.startsWith('/api/shoot/')) {
        const upstream = http.request({host: '127.0.0.1', port: apiPort, method: req.method, path: url.pathname + url.search, headers: {...headers(req.headers), host: origin.host}, agent: false}, response => {
          res.writeHead(response.statusCode, {...headers(response.headers), 'cache-control': 'no-store'});
          pipeline(response, res).catch(() => res.destroy());
        });
        upstream.setTimeout(35000, () => upstream.destroy());
        upstream.on('error', () => {
          if (res.headersSent) res.destroy();
          else end(res, 503, {error: {code: 'server', message: '拍照后台暂时连不上，可以先去打一局', retry: 'same', charged: false}});
        });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
        pipeline(req, upstream).catch(() => upstream.destroy());
        return;
      }
      if (!webRoot || !['GET', 'HEAD'].includes(req.method) || route.startsWith('/api/') || route === '/~!frp') return end(res, 404, {error: 'not-found'});
      const root = await fs.realpath(webRoot), name = decodeURIComponent(route === '/' ? '/index.html' : route);
      const candidate = path.resolve(root, '.' + name);
      if (!candidate.startsWith(root + path.sep)) return end(res, 404, {error: 'not-found'});
      const file = await fs.realpath(candidate), type = TYPES[path.extname(file)];
      if (!file.startsWith(root + path.sep) || !type) return end(res, 404, {error: 'not-found'});
      let bytes = await fs.readFile(file);
      // Images/models are transformed during build. Revalidate all files so a
      // rebuilt model with the same source hash cannot retain old compressed bytes.
      const output = {'content-type': type, 'cache-control': path.extname(file) === '.html' ? 'no-store' : 'no-cache', 'content-length': bytes.length};
      if (['.html', '.js', '.css', '.json', '.wasm', '.svg'].includes(path.extname(file))) {
        output.vary = 'Accept-Encoding';
        if (String(req.headers['accept-encoding'] ?? '').split(',').some(s => /^gzip(?:\s*;\s*q=(?!0(?:\.0*)?$)[\d.]+)?$/i.test(s.trim()))) {
          bytes = gzipSync(bytes); output['content-encoding'] = 'gzip'; output['content-length'] = bytes.length;
        }
      }
      res.writeHead(200, output); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (res.headersSent) res.destroy(); else end(res, 404, {error: 'not-found'}); }
  };
  const server = tls ? https.createServer({...tls, minVersion: 'TLSv1.2'}, handler) : http.createServer(handler);
  server.headersTimeout = 10000; server.requestTimeout = 35000;
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (req.url !== '/~!frp' || req.method !== 'GET') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const upstream = http.request({host: '127.0.0.1', port: frpPort, path: '/~!frp', method: 'GET', headers: {...req.headers, host: '127.0.0.1:' + frpPort}, agent: false});
    upstream.setTimeout(10000, () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('response', response => { response.resume(); socket.destroy(); });
    upstream.on('upgrade', (response, other, extra) => {
      upstream.setTimeout(0);
      sockets.add(socket); sockets.add(other);
      const close = () => { sockets.delete(socket); sockets.delete(other); socket.destroy(); other.destroy(); };
      for (const s of [socket, other]) { s.on('error', close); s.on('close', close); }
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
      if (extra.length) socket.write(extra);
      if (head.length) other.write(head);
      socket.pipe(other); other.pipe(socket);
    });
    upstream.end();
  });
  return {server, disconnect() { for (const socket of sockets) socket.destroy(); }};
}
