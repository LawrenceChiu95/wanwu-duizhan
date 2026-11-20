import {execFileSync} from 'node:child_process';
import {access, copyFile, cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const [web, destination, mode] = process.argv.slice(2);
const judge = mode === '--judge';
const repo = fileURLToPath(new URL('../../', import.meta.url));
if ((mode && !judge) || !isAbsolute(web ?? '') || !isAbsolute(destination ?? '') ||
    !relative(repo, destination).startsWith('..') ||
    !relative(web, destination).startsWith('..') || !relative(destination, web).startsWith('..')) {
  throw Error('Usage: node tools/netplay/stage.mjs /absolute/built-web /absolute/new-bundle [--judge]');
}
await access(resolve(web, 'index.html'));
// The page as it ships, on a network that cuts its files off (web/test/netplay-load.test.mjs): asked for again, then said
// in words with 重新加载, never a dead 准备 (远夏 801288e4, Elara cd588352). A page failing it is not staged.
execFileSync(process.execPath, ['--test', resolve(repo, 'web/test/netplay-load.test.mjs')], {cwd: resolve(repo, 'web'), env: {...process.env, NETPLAY_WEB: web}, stdio: 'inherit'});
await mkdir(destination);
const items = ['item-rating.js', 'runtime-items.js', 'v3-rules.json'].map(name => 'sim/' + name);
const service = ['items.mjs', 'rooms.mjs', 'server.mjs', 'package.json', 'package-lock.json'];
if (!judge) service.push('main.mjs', 'frps.toml');
const tunnel = ['gateway.mjs', 'download-frp.mjs'];
if (judge) tunnel.push('start.mjs', 'frps.toml');
await Promise.all(['data', 'sim', 'tools/netplay', 'tools/studio'].map(dir => mkdir(resolve(destination, dir), {recursive: true})));
const files = [...items, ...service.map(name => 'tools/netplay/' + name), ...tunnel.map(name => 'tools/studio/' + name), 'data/catalog.json'];
await Promise.all(files.map(path => copyFile(resolve(repo, path), resolve(destination, path))));
await copyFile(resolve(repo, judge ? 'tools/studio/Dockerfile.netplay' : 'tools/netplay/Dockerfile'), resolve(destination, 'Dockerfile'));
const webRoot = resolve(destination, 'web');
await cp(web, webRoot, {recursive: true});
// For the judge, the existing gateway preloads and compresses the immutable build.
for (const entry of judge ? [] : await readdir(webRoot, {recursive: true, withFileTypes: true})) {
  if (!entry.isFile() || !/\.(?:wasm|js|glb)$/.test(entry.name)) continue;
  const path = resolve(entry.parentPath, entry.name);
  const source = await readFile(path);
  const compressed = gzipSync(source);
  if (compressed.length < source.length) await writeFile(path + '.gz', compressed);
}
await writeFile(resolve(destination, 'README.md'), judge
  ? '---\ntitle: 万物对战\nsdk: docker\napp_port: 7860\n---\n\n万物对战的评委试玩空间。\n'
  : '---\ntitle: 万物对战·好友对撞\nsdk: docker\napp_port: 7860\n---\n\n万物对战的好友对撞试玩空间。\n');
