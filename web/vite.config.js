import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const rapier = fileURLToPath(new URL('../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url));
// Phone entry goes through the tailnet proxy, which keeps its own Host header.
const allowedHosts = ['lawrence-mac', 'lawrence-mac.tail1c8f33.ts.net'];

// 评委版 (--mode judge, task #4): the opening card goes into the page itself, so it shows before the scripts arrive.
// 好友对撞's page (WANWU_NETPLAY=1) has it without 评委试玩: a friend sent its code is no judge (Elara 4a54464d).
const BADGE = ['<header class="khead"><i></i> 评委试玩 ', '<header class="khead plain">'];
const judgeIntro = {
  name: 'judge-intro',
  transformIndexHtml: {order: 'pre', handler: html => {
    let intro = readFileSync(new URL('./judge-intro.html', import.meta.url), 'utf8');
    if (netplayBuild) {
      if (!intro.includes(BADGE[0])) throw Error('judge-intro.html: 评委试玩 badge not found (changed?)');
      intro = intro.replace(BADGE[0], BADGE[1]).replace('aria-label="万物对战 · 评委试玩"', 'aria-label="万物对战"');
    }
    return html.replace('<!-- judge-intro -->', intro);
  }}
};
// 评委版 build only: rapier3d-compat carries its engine as base64 inside the script (1.65 MB gzipped). The same bytes as a
// .wasm file next to it are 1.17 MB gzipped and start compiling while they download; the engine is unchanged.
const rapierWasm = {
  name: 'rapier-wasm-file',
  apply: 'build',
  transform(code, id) {
    if (!id.includes('rapier3d-compat')) return null;
    // module_or_path: <base64>.toByteArray("…").buffer, the bytes handed to wasm-bindgen; a URL there is fetched instead.
    const m = code.match(/module_or_path:([\w$]+)\.toByteArray\("([A-Za-z0-9+/=]+)"\)(\.buffer)?/);
    if (!m) throw Error('rapier3d-compat: inlined wasm not found (package changed?)');
    const ref = this.emitFile({type: 'asset', name: 'rapier.wasm', source: Buffer.from(m[2], 'base64')});
    return {code: code.replace(m[0], `module_or_path:new URL(import.meta.ROLLUP_FILE_URL_${ref})`), map: null};
  }
};

// 评委版候选 (Elara e0e9c290): the rules are chosen when the page is built, not on it. WANWU_COMBAT=current or position
// gives a page that plays only those rules; unset, ?combat=position picks the new ones as before.
const combatBuild = process.env.WANWU_COMBAT ?? '';
if (!['', 'current', 'position'].includes(combatBuild)) throw Error(`WANWU_COMBAT must be current or position, not ${combatBuild}`);

// 好友对撞 (tools/netplay): WANWU_NETPLAY=1 gives the page that the room service serves, with the 好友对撞 key. Without it
// the page never asks for the room service (the 评委版 link makes no backend request, scripts/check-judge-navigation.mjs).
const netplayBuild = process.env.WANWU_NETPLAY === '1';

export default defineConfig(({mode}) => {
  const judge = mode === 'judge';
  return {
    base: './',
    define: {__JUDGE__: JSON.stringify(judge), __COMBAT__: JSON.stringify(combatBuild), __NETPLAY__: JSON.stringify(netplayBuild)},
    plugins: judge ? [judgeIntro, rapierWasm] : [],
    // 评委版 bundles the twelve's models only (src/model-files.judge.js).
    resolve: {alias: [{find: '@dimforge/rapier3d-compat', replacement: rapier}, ...judge ? [{find: /^\.\/model-files\.js$/, replacement: './model-files.judge.js'}] : []]},
    // ?shoot=real: the local 拍一件 backend (tools/import-item/shoot), same origin through this proxy; start it with
    // --frontend-origin set to this page's origin. SHOOT_PORT if it isn't on 4408.
    server: {fs: {allow: [repo]}, allowedHosts,
      proxy: {'/api/shoot': {target: `http://127.0.0.1:${process.env.SHOOT_PORT ?? 4408}`, changeOrigin: true}}},
    preview: {allowedHosts},
    // Separate chunks so each Artifacts publish batch stays under the upload limit.
    build: {target: 'es2022', chunkSizeWarningLimit: 5000, assetsInlineLimit: 0, rollupOptions: {output: {manualChunks(id) {
      if (id.includes('rapier3d-compat')) return 'rapier';
      // 首页's 看碰撞体 only (potview.js): with the pot's 3D, not in the first screen's three.
      if (/node_modules\/three\/examples\/jsm\/(geometries\/ConvexGeometry|math\/ConvexHull)/.test(id)) return 'potshell';
      if (id.includes('node_modules/three')) return 'three';
    }}}}
  };
});
