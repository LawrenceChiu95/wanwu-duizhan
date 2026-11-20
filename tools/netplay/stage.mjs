import {access, copyFile, cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const [web, destination] = process.argv.slice(2);
const repo = fileURLToPath(new URL('../../', import.meta.url));
if (!isAbsolute(web ?? '') || !isAbsolute(destination ?? '') ||
    !relative(repo, destination).startsWith('..') ||
    !relative(web, destination).startsWith('..') || !relative(destination, web).startsWith('..')) {
  throw Error('Usage: node tools/netplay/stage.mjs /absolute/built-web /absolute/new-bundle');
}
await access(resolve(web, 'index.html'));
await mkdir(destination);
const items = ['item-rating.js', 'runtime-items.js', 'v3-rules.json'].map(name => 'sim/' + name);
const service = ['items.mjs', 'main.mjs', 'rooms.mjs', 'server.mjs', 'package.json', 'package-lock.json'].map(name => 'tools/netplay/' + name);
await Promise.all(['data', 'sim', 'tools/netplay'].map(dir => mkdir(resolve(destination, dir), {recursive: true})));
await Promise.all([...items, ...service, 'data/catalog.json'].map(path => copyFile(resolve(repo, path), resolve(destination, path))));
await copyFile(resolve(repo, 'tools/netplay/Dockerfile'), resolve(destination, 'Dockerfile'));
const webRoot = resolve(destination, 'web');
await cp(web, webRoot, {recursive: true});
for (const entry of await readdir(webRoot, {recursive: true, withFileTypes: true})) {
  if (!entry.isFile() || !/\.(?:wasm|js|glb)$/.test(entry.name)) continue;
  const path = resolve(entry.parentPath, entry.name);
  const source = await readFile(path);
  const compressed = gzipSync(source);
  if (compressed.length < source.length) await writeFile(path + '.gz', compressed);
}
await writeFile(resolve(destination, 'README.md'), '---\ntitle: 万物对战·好友对撞\nsdk: docker\napp_port: 7860\n---\n\n万物对战的好友对撞试玩空间。\n');
