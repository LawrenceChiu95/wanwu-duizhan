import {execFileSync} from 'node:child_process';
import {access, copyFile, cp, mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const [web, destination] = process.argv.slice(2);
const repo = fileURLToPath(new URL('../../', import.meta.url));
if (!isAbsolute(web ?? '') || !isAbsolute(destination ?? '') ||
    !relative(repo, destination).startsWith('..') ||
    !relative(web, destination).startsWith('..') || !relative(destination, web).startsWith('..')) {
  throw Error('Usage: node tools/netplay/stage.mjs /absolute/built-web /absolute/new-bundle');
}
await access(resolve(web, 'index.html'));
// The page as it ships, on a network that cuts its files off (web/test/netplay-load.test.mjs): asked for again, then said
// in words with 重新加载, never a dead 准备 (远夏 801288e4, Elara cd588352). A page failing it is not staged.
execFileSync(process.execPath, ['--test', resolve(repo, 'web/test/netplay-load.test.mjs')], {cwd: resolve(repo, 'web'), env: {...process.env, NETPLAY_WEB: web}, stdio: 'inherit'});
await mkdir(destination);
const items = ['item-rating.js', 'runtime-items.js', 'v3-rules.json'].map(name => 'sim/' + name);
const service = ['items.mjs', 'main.mjs', 'rooms.mjs', 'server.mjs', 'package.json', 'package-lock.json'].map(name => 'tools/netplay/' + name);
await Promise.all(['data', 'sim', 'tools/netplay'].map(dir => mkdir(resolve(destination, dir), {recursive: true})));
await Promise.all([...items, ...service, 'data/catalog.json'].map(path => copyFile(resolve(repo, path), resolve(destination, path))));
await copyFile(resolve(repo, 'tools/netplay/Dockerfile'), resolve(destination, 'Dockerfile'));
await cp(web, resolve(destination, 'web'), {recursive: true});
await writeFile(resolve(destination, 'README.md'), '---\ntitle: 万物对战·好友对撞\nsdk: docker\napp_port: 7860\n---\n\n万物对战的好友对撞试玩空间。\n');
