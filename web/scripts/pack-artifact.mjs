// Pack the built game for Raft Artifacts: a cover page at index.html, the game under play/.
// Usage (from web/, after `npx vite build`): node scripts/pack-artifact.mjs [outDir=/tmp/wanwu-top-demo-pack]
// - play/index.html gets `window.createImageBitmap = undefined;` (the viewer blocks fetch of blob: URLs, which
//   three.js uses for GLB textures through createImageBitmap; without it three falls back to <img>). Published copy only.
// - Writes batches.json: groups of files, each under ~4.6 MB once inlined, for publish_artifact.
import {readFile, writeFile, mkdir, readdir, copyFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
const out = process.argv[2] ?? '/tmp/wanwu-top-demo-pack';
await rm(out, {recursive: true, force: true});
await mkdir(join(out, 'play/assets'), {recursive: true});
const assets = await readdir('dist/assets');
for (const f of assets) await copyFile(join('dist/assets', f), join(out, 'play/assets', f));
let play = await readFile('dist/index.html', 'utf8');
const at = play.indexOf('<script');
if (at < 0) throw Error('no script tag in dist/index.html');
play = play.slice(0, at) + '<script>window.createImageBitmap = undefined;</script>\n' + play.slice(at);
await writeFile(join(out, 'play/index.html'), play);
await copyFile('publish/cover.html', join(out, 'index.html'));
// The cover's pictures (凡朔's reactors and the terminal frame and button faces) sit in media/ beside it.
await mkdir(join(out, 'media'));
const media = await readdir('publish/media');
for (const f of media) await copyFile(join('publish/media', f), join(out, 'media', f));
const files = ['index.html', ...media.map(f => `media/${f}`), 'play/index.html', ...assets.map(f => `play/assets/${f}`)];
const text = f => /\.(html|js|css|json|md|txt|svg)$/.test(f);
const sized = await Promise.all(files.map(async f => { const s = (await stat(join(out, f))).size; return {f, size: s, inline: text(f) ? s : Math.ceil(s / 3) * 4}; }));
const LIMIT = 4.6e6, batches = [];
for (const x of sized.sort((a, b) => a.inline - b.inline)) {
  const b = batches.find(b => b.total + x.inline <= LIMIT);
  if (b) { b.files.push(x.f); b.total += x.inline; } else batches.push({files: [x.f], total: x.inline});
}
// The entry page goes in the first batch.
batches.sort((a, b) => b.files.includes('index.html') - a.files.includes('index.html'));
await writeFile(join(out, '..', 'wanwu-top-demo-batches.json'), JSON.stringify({out, total: sized.reduce((s, x) => s + x.size, 0), batches}, null, 1));
console.log(JSON.stringify({out, files: files.length, total: sized.reduce((s, x) => s + x.size, 0), batches: batches.map(b => ({n: b.files.length, mb: +(b.total / 1e6).toFixed(2)}))}));
