import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2'};
const compress = promisify(gzip);
const tag = bytes => '"' + createHash('sha256').update(bytes).digest('hex') + '"';
async function loadStatic(root, compressModels) {
  root = await fs.realpath(root);
  const files = new Map();
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, {withFileTypes: true})) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      // Only regular files from the immutable build; never follow a symlink.
      else if (entry.isFile() && TYPES[path.extname(file)]) {
        const ext = path.extname(file), bytes = await fs.readFile(file);
        const compressible = ['.html', '.js', '.css', '.json', '.wasm', '.svg'].includes(ext) || (compressModels && ext === '.glb');
        const compressed = compressible ? await compress(bytes) : null;
        files.set('/' + path.relative(root, file).split(path.sep).join('/'), {
          type: TYPES[ext], cache: ext === '.html' ? 'no-store' : /-[A-Za-z0-9_-]{8,}\.(js|css|wasm)$/.test(entry.name) ? 'public, max-age=31536000, immutable' : 'no-cache',
          plain: {bytes, etag: tag(bytes)}, gzip: compressed && (ext !== '.glb' || compressed.length < bytes.length) ? {bytes: compressed, etag: tag(compressed)} : null
        });
      }
    }
  }
  await walk(root);
  return files;
}

function end(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'});
  res.end(JSON.stringify(value));
}
function headers(input) {
  const skip = new Set(['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...String(input.connection ?? '').split(',').map(s => s.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !skip.has(name)));
}

// The platform terminates TLS. Photo requests and FRP upgrades have fixed
// loopback destinations. The judge build can also dispatch room requests.
export function createGateway({publicOrigin, webRoot = null, apiPort = 7001, frpPort = 7000, tls = null, rooms = null}) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw Error('Exact HTTPS public origin required');
  const sockets = new Set(), ready = webRoot ? loadStatic(webRoot, Boolean(rooms)) : Promise.resolve(null);
  const handler = async (req, res) => {
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return end(res, 400, {error: 'bad-request'});
      const url = new URL(req.url, publicOrigin), route = url.pathname;
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('x-content-type-options', 'nosniff');
      if (route === '/_health' && req.method === 'GET') return end(res, 200, {service: 'wanwu-studio', role: 'transport-only'});
      if (rooms && (route === '/api/netplay/health' || route.startsWith('/api/netplay/models/'))) {
        rooms.emit('request', req, res);
        return;
      }
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
      const file = (await ready).get(decodeURIComponent(route === '/' ? '/index.html' : route));
      if (!file) return end(res, 404, {error: 'not-found'});
      const useGzip = file.gzip && String(req.headers['accept-encoding'] ?? '').split(',').some(s => /^gzip(?:\s*;\s*q=(?!0(?:\.0*)?$)[\d.]+)?$/i.test(s.trim()));
      const {bytes, etag} = useGzip ? file.gzip : file.plain;
      const output = {'content-type': file.type, 'cache-control': file.cache, etag};
      if (file.gzip) output.vary = 'Accept-Encoding';
      if (useGzip) output['content-encoding'] = 'gzip';
      if (String(req.headers['if-none-match'] ?? '').split(',').some(s => s.trim() === '*' || s.trim().replace(/^W\//, '') === etag)) {
        res.writeHead(304, output); res.end(); return;
      }
      output['content-length'] = bytes.length;
      res.writeHead(200, output); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (res.headersSent) res.destroy(); else end(res, 404, {error: 'not-found'}); }
  };
  const server = tls ? https.createServer({...tls, minVersion: 'TLSv1.2'}, handler) : http.createServer(handler);
  server.headersTimeout = 10000; server.requestTimeout = 35000;
  function upgradeTunnel(req, socket, head) {
    // ModelScope percent-encodes ! before forwarding the upgrade. Accept only
    // that observed spelling or frp's literal path, with no query or suffix.
    if (!['/~!frp', '/~%21frp'].includes(req.url) || req.method !== 'GET') return false;
    socket.on('error', () => socket.destroy());
    const upstream = http.request({host: '127.0.0.1', port: frpPort, path: '/~!frp', method: 'GET', headers: {...req.headers, host: '127.0.0.1:' + frpPort}, agent: false});
    upstream.setTimeout(10000, () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('response', response => { console.warn('frps refused upgrade', {status: response.statusCode}); response.resume(); socket.destroy(); });
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
    return true;
  }
  server.on('upgrade', (req, socket, head) => {
    if (rooms && req.url === '/api/netplay/ws' && req.method === 'GET') {
      rooms.emit('upgrade', req, socket, head);
      return;
    }
    if (upgradeTunnel(req, socket, head)) return;
    socket.on('error', () => socket.destroy());
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return {server, ready, upgradeTunnel, disconnect() { for (const socket of sockets) socket.destroy(); }};
}
