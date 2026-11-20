import http from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {mountRooms} from './rooms.mjs';

const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json', glb: 'model/gltf-binary', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2',
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', mp4: 'video/mp4',
  mp3: 'audio/mpeg', spz: 'application/octet-stream', txt: 'text/plain; charset=utf-8'
};
const modelPath = /^\/api\/netplay\/models\/([23456789A-HJ-NP-Z]{6})\/([a-f0-9-]{36})\/(shoot_[a-f0-9-]{36})$/;
const shootGet = /^\/api\/shoot\/(?:health|quota|items|jobs\/j_[a-f0-9-]{36}|files\/shoot_[a-f0-9-]{36}\/(?:model\.glb|photo\.jpg|styled\.jpg))$/;
const shootPost = /^\/api\/shoot\/(?:session|jobs|jobs\/j_[a-f0-9-]{36}\/(?:retry|regenerate|retake|category))$/;
const uploadLimit = 32 * 1024 ** 2 + 65536;
const traceLimit = 256;

export function shootClient(upstream) {
  if (!upstream) return null;
  const url = new URL(upstream);
  if (url.origin !== upstream || (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw Error('Use an exact HTTPS upstream origin or a local fixture');
  }
  return (path, init = {}) => fetch(new URL(path, url), {
    ...init, redirect: 'error', headers: {'user-agent': 'Mozilla/5.0 (Wanwu Netplay)', ...init.headers},
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(12_000)
  });
}

function json(res, status, payload) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(payload));
}

function publicError(res, status, code) {
  json(res, status, {error: {code}});
}

async function relayResponse(response, res) {
  res.writeHead(response.status, {
    'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  if (!response.body) return res.end();
  await pipeline(Readable.fromWeb(response.body), res);
}

async function forwardShoot(req, res, pathname, shoot) {
  if (!shoot) return publicError(res, 404, 'no-backend');
  const headers = Object.fromEntries(['content-type', 'x-shoot-session', 'x-shoot-pass', 'x-shoot-category']
    .filter(name => typeof req.headers[name] === 'string').map(name => [name, req.headers[name]]));
  const cancel = new AbortController();
  res.on('close', () => { if (!res.writableFinished) cancel.abort(); });
  const init = {method: req.method, headers, signal: cancel.signal};
  if (req.method === 'POST') {
    if (Number(req.headers['content-length']) > uploadLimit) return publicError(res, 413, 'photo-invalid');
    let n = 0;
    const limit = new Transform({
      transform(chunk, _encoding, next) {
        n += chunk.length;
        next(n > uploadLimit ? Error('Photo body too large') : null, chunk);
      }
    });
    req.on('error', cause => limit.destroy(cause));
    Object.assign(init, {body: req.pipe(limit), duplex: 'half'});
  }
  await relayResponse(await shoot(pathname, init), res);
}

function encodingWeights(header = '') {
  return new Map(header.toLowerCase().split(',').map(value => {
    const [encoding, weight] = value.trim().split(/\s*;\s*/, 2);
    if (weight === undefined) return [encoding, 1];
    const quality = weight.match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/)?.[1];
    return [encoding, Number(quality ?? 0)];
  }));
}

async function serveAsset(req, res, pathname, webRoot) {
  if (!webRoot || !/^[a-zA-Z0-9_./-]+$/.test(pathname) ||
      pathname.split('/').some(segment => segment.startsWith('.'))) return publicError(res, 404, 'not-found');
  const local = resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!local.startsWith(webRoot + sep)) return publicError(res, 404, 'not-found');
  const type = types[local.split('.').pop()];
  if (!type) return publicError(res, 404, 'not-found');
  const file = await stat(local);
  if (!file.isFile()) return publicError(res, 404, 'not-found');
  let selected = local;
  let size = file.size;
  const weights = encodingWeights(req.headers['accept-encoding']);
  const gzipWeight = weights.get('gzip') ?? weights.get('*') ?? 0;
  const identityWeight = weights.get('identity');
  if (/\.(?:wasm|js|glb)$/.test(local)) {
    res.setHeader('Vary', 'Accept-Encoding');
    if (gzipWeight > 0 && gzipWeight >= (identityWeight ?? 0)) {
      const gzipPath = local + '.gz';
      const gzip = await stat(gzipPath).catch(cause => {
        if (cause.code !== 'ENOENT') throw cause;
      });
      if (gzip?.isFile()) {
        selected = gzipPath;
        size = gzip.size;
        res.setHeader('Content-Encoding', 'gzip');
      }
    }
  }
  if (selected === local && (identityWeight ?? weights.get('*')) === 0) {
    return publicError(res, 406, 'encoding');
  }
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': size,
    'Cache-Control': /^\/assets\/.+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9]+$/.test(pathname)
      ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(selected), res);
}

export async function traceWriter(directory) {
  const root = resolve(directory);
  await mkdir(root, {recursive: true, mode: 0o700});
  let count = (await readdir(root)).filter(name => /^[a-f0-9-]{36}-[01]\.json$/.test(name)).length;
  return async trace => {
    if (count >= traceLimit) throw Error('Trace directory full');
    count++;
    try {
      await writeFile(join(root, `${trace.matchId}-${trace.seat}.json`), JSON.stringify(trace) + '\n', {flag: 'wx', mode: 0o600});
    } catch (cause) {
      count--;
      throw cause;
    }
  };
}

export function createNetplayServer({origin, webRoot, upstream, storeTrace, ...roomOptions}) {
  if (!origin || new URL(origin).origin !== origin || (upstream && upstream === origin)) {
    throw Error('Use an exact netplay origin different from the shoot upstream');
  }
  const shoot = shootClient(upstream);
  const root = webRoot && resolve(webRoot);
  const serve = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') ||
        (req.headers.origin && req.headers.origin !== origin)) return publicError(res, 403, 'origin');
    const {pathname, search} = new URL(req.url, origin);
    if (pathname.startsWith('/api/') && search) return publicError(res, 404, 'not-found');
    if (pathname === '/api/netplay/health' && req.method === 'GET') return json(res, 200, {status: 'ok'});

    const lookup = pathname.match(modelPath);
    if (lookup && req.method === 'GET') {
      const selected = rooms.model(...lookup.slice(1), req.headers['x-netplay-seat']);
      if (!selected || !shoot) return publicError(res, 404, 'not-found');
      const cancel = new AbortController();
      res.on('close', () => { if (!res.writableFinished) cancel.abort(); });
      const file = await shoot(selected.source, {headers: {'x-shoot-session': selected.shootSession}, signal: cancel.signal});
      if (!file.ok) {
        await file.body?.cancel();
        return publicError(res, file.status === 404 ? 404 : 502, 'model');
      }
      if (file.headers.get('Content-Type')?.split(';')[0] !== 'model/gltf-binary') {
        await file.body?.cancel();
        return publicError(res, 502, 'model');
      }
      return relayResponse(file, res);
    }
    if ((req.method === 'GET' && shootGet.test(pathname)) || (req.method === 'POST' && shootPost.test(pathname))) {
      if (req.method === 'POST' && req.headers.origin !== origin) return publicError(res, 403, 'origin');
      return forwardShoot(req, res, pathname, shoot);
    }
    if (pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) return publicError(res, 404, 'not-found');
    return serveAsset(req, res, pathname, root);
  };

  const server = http.createServer((req, res) => serve(req, res).catch(cause => {
    if (res.headersSent || res.destroyed) return res.destroy();
    if (cause.code === 'ENOENT') return publicError(res, 404, 'not-found');
    publicError(res, 502, 'offline');
  }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  const rooms = mountRooms(server, {origin, shoot, storeTrace, ...roomOptions});
  return {
    server,
    async close() {
      rooms.close();
      if (server.listening) await new Promise(resolve => {
        server.close(resolve);
        server.closeIdleConnections();
      });
    }
  };
}
