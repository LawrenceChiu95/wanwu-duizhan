import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

// The platform rejects the upstream WebSocket handshake's empty User-Agent.
// Pin official v0.72.0 sources; change only that handshake header on the Mac.
const commit = 'bafec21abce5f91ae4a05b4bd19c55543c263128';
const sourceURL = `https://codeload.github.com/fatedier/frp/tar.gz/${commit}`;
const sourceSHA256 = 'f2ca96a4d94db2575d2a360f03480dc5db3a5aca59ac73d1ca24e86f9411630c';
const {values: v} = parseArgs({options: {out: {type: 'string'}, archive: {type: 'string'}}});
if (!path.isAbsolute(v.out ?? '')) throw Error('Absolute --out required');
if (v.archive && !path.isAbsolute(v.archive)) throw Error('Absolute --archive required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let bytes;
if (v.archive) bytes = await fs.readFile(v.archive);
else {
  const response = await fetch(sourceURL, {signal: AbortSignal.timeout(90000)});
  if (!response.ok) throw Error('frp source download failed');
  bytes = Buffer.from(await response.arrayBuffer());
}
if (hash(bytes) !== sourceSHA256) throw Error('frp source checksum mismatch');
// Refuse an existing output directory, including a symlink; never overwrite.
await fs.mkdir(v.out, {mode: 0o700});
const archive = path.join(v.out, 'source.tar.gz'), source = path.join(v.out, 'source');
await fs.writeFile(archive, bytes);
await fs.mkdir(source);
async function run(bin, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {cwd, env, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(bin + ' failed: ' + code)));
  });
}
await run('tar', ['-xzf', archive, '--strip-components=1', '-C', source]);
const file = path.join(source, 'pkg/util/net/dial.go');
const original = await fs.readFile(file, 'utf8');
const needle = '\n\t\tconn, err := websocket.NewClient(cfg, c)';
if (original.split(needle).length !== 2) throw Error('Unexpected frp handshake source');
const changed = original.replace(needle, '\n\t\tcfg.Header.Set("User-Agent", "Go-http-client/1.1")\n' + needle);
await fs.writeFile(file, changed);
const binary = path.join(v.out, 'frpc');
// Match upstream's no-web build when dist assets are absent; this tunnel does
// not expose a client dashboard. Limit compiler parallelism on the shared Mac.
await run('go', ['build', '-p', '1', '-trimpath', '-tags', 'frpc,noweb', '-o', binary, './cmd/frpc'], source, {...process.env, CGO_ENABLED: '0'});
const manifest = {upstreamVersion: '0.72.0', commit, sourceURL, sourceSHA256,
  patch: 'pkg/util/net/dial.go: WebSocket User-Agent=Go-http-client/1.1', buildTags: 'frpc,noweb',
  binarySHA256: hash(await fs.readFile(binary))};
await fs.writeFile(path.join(v.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
