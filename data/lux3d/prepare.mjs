// Wren 2026-10-26: 把 Aholo Lux3D 生成的 GLB 变成和 data/models/ 同规格的资产
// （包围盒居中、最长轴缩到指定米数、Y 向上、≤64 点凸包、真实体积/质量）。
// 用法：node data/lux3d/prepare.mjs        （从仓库根跑，需 sim/node_modules 里的 rapier）
// 每件东西出两份：-lite（减面、无贴图、给手机跑）和 -pbr（原始网格+贴图、好看但大）。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
// rapier 装在 sim/node_modules 里；data/ 下没有自己的依赖，直接指到那个包。
const RAPIER_URL = new URL('../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url);
let R;
try { R = (await import(RAPIER_URL)).default; }
catch (e) { throw new Error('找不到 rapier，先在 sim/ 目录跑 npm ci：' + e.message); }
await R.init();

const here = path.dirname(new URL(import.meta.url).pathname);
// 原始导出在 Wren 的工作区里，体积太大不进仓库；路径和 sha256 记在 RECEIPT.md。
const RAW = '/Users/lawrence/.slock/agents/7786aa12-7844-4bb6-aa41-2c30762a0aa5/work/hackathon-1026/models';
const materials = {
  metal: { density: 2700 }, wood: { density: 650 }, cloth: { density: 60 },
  plastic: { density: 950 }, rubber: { density: 400 },
};
// Lux3D 出来的东西：锅按金属实心算（和现有 pot 一致），台灯按塑料。
const specs = [
  {
    id: 'pan-lux3d', name: '铸铁煎锅（AI 生成）', material: 'metal', length: 0.38, tag: 'neutral',
    hp: 150, attack: 12, defense: 6, orient: 'longToZ',
    lite: 'pan.source.glb', pbr: `${RAW}/pan/lux3d_g1_26997.glb`,
  },
  {
    id: 'lamp-lux3d', name: '艺术台灯（AI 生成）', material: 'plastic', length: 0.45, tag: 'neutral',
    hp: 130, attack: 12, defense: 4, orient: 'none',
    lite: 'lamp.source.glb', pbr: `${RAW}/lamp/lux3d_g1_27029.glb`,
  },
];

function multiply(a, b) { const c = Array(16).fill(0); for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) c[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k]; return c; }
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function matrix(n) { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0]; return [(1 - 2 * y * y - 2 * z * z) * sx, (2 * x * y + 2 * w * z) * sx, (2 * x * z - 2 * w * y) * sx, 0, (2 * x * y - 2 * w * z) * sy, (1 - 2 * x * x - 2 * z * z) * sy, (2 * y * z + 2 * w * x) * sy, 0, (2 * x * z + 2 * w * y) * sz, (2 * y * z - 2 * w * x) * sz, (1 - 2 * x * x - 2 * y * y) * sz, 0, tx, ty, tz, 1]; }
const transform = (m, p) => [0, 1, 2].map(r => m[r] * p[0] + m[r + 4] * p[1] + m[r + 8] * p[2] + m[r + 12]);
function readGlb(buf) { const len = buf.readUInt32LE(12); const g = JSON.parse(buf.subarray(20, 20 + len)); const bin = buf.subarray(28 + len); return { g, bin }; }
function writeGlb(g, bin) { let j = Buffer.from(JSON.stringify(g)); j = Buffer.concat([j, Buffer.alloc((4 - j.length % 4) % 4, 32)]); const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + j.length + bin.length, 8); h.writeUInt32LE(j.length, 12); h.writeUInt32LE(0x4e4f534a, 16); const b = Buffer.alloc(8); b.writeUInt32LE(bin.length); b.writeUInt32LE(0x004e4942, 4); return Buffer.concat([h, j, b, bin]); }
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

// 顶点几万个，不能把数组摊成参数调 Math.min（会爆栈）
function minMax(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
  return { min, max };
}

// 支撑方向收出紧凑包络（和 prepare-assets.mjs 的 26 向一致）
function collectVertices(g, bin) {
  const out = [];
  function walk(ni, parent) {
    const n = g.nodes[ni], m = multiply(parent, matrix(n));
    if (n.mesh !== undefined) for (const p of g.meshes[n.mesh].primitives) {
      const a = g.accessors[p.attributes.POSITION], v = g.bufferViews[a.bufferView];
      if (a.componentType !== 5126 || a.type !== 'VEC3' || a.sparse) throw Error('Unsupported POSITION');
      for (let i = 0; i < a.count; i++) { const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? 12); out.push(transform(m, [0, 4, 8].map(k => bin.readFloatLE(off + k)))); }
    }
    for (const ch of n.children ?? []) walk(ch, m);
  }
  // 源文件可能有多个根节点，全走一遍
  for (const ni of g.scenes[g.scene ?? 0].nodes) walk(ni, identity());
  return out;
}

async function build(spec, kind, srcPath, expect) {
  const raw = await fs.readFile(srcPath);
  const { g, bin } = readGlb(raw);
  const node = g.nodes.length;
  g.nodes.push({ name: 'prototype_meters_centered', matrix: spec.matrix, children: g.scenes[g.scene ?? 0].nodes });
  g.scenes[g.scene ?? 0].nodes = [node];
  const normalized = writeGlb(g, bin);
  const file = `${spec.id}${kind === 'pbr' ? '-pbr' : ''}.glb`;
  await fs.writeFile(path.join(here, file), normalized);

  // 回读自己写的文件，确认引擎看到的包围盒就是源网格套上矩阵后的那份。
  const { g: g2, bin: bin2 } = readGlb(normalized);
  const got = minMax(collectVertices(g2, bin2));
  const drift = Math.max(...[0, 1, 2].map(k => Math.max(Math.abs(got.min[k] - expect.min[k]), Math.abs(got.max[k] - expect.max[k]))));
  if (!(drift < 1e-5)) throw new Error(`${spec.id}/${kind} 回读包围盒对不上，偏差 ${drift}`);
  return { kind, file, sha256: hash(normalized), bytes: normalized.length, hasTexture: !!(g.images && g.images.length), verifyDrift: drift };
}

const entries = [], files = [];
for (const spec of specs) {
  // 归一化以原始高模为准（几何真相），减面版的矩阵和凸包都跟它对齐。
  const pbrRaw = await fs.readFile(spec.pbr);
  const pbrGlb = readGlb(pbrRaw);
  const vertices = collectVertices(pbrGlb.g, pbrGlb.bin);
  if (!vertices.length) throw new Error(spec.id + ' 没有顶点');

  const { min: lo, max: hi } = minMax(vertices);
  const span = hi.map((v, k) => v - lo[k]);
  const center = hi.map((v, k) => (v + lo[k]) / 2);
  const scale = spec.length / Math.max(...span);

  // 锅按 broom 的规矩把长轴转到 +Z（躺平、柄朝前）；台灯保持竖直不动。
  let orient = identity();
  if (spec.orient === 'longToZ') {
    const axis = span.indexOf(Math.max(...span));
    if (axis === 0) orient = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
    if (axis === 1) orient = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
  }
  const normalize = identity();
  normalize[0] = normalize[5] = normalize[10] = scale;
  normalize[12] = -center[0] * scale; normalize[13] = -center[1] * scale; normalize[14] = -center[2] * scale;
  const m = multiply(orient, normalize);
  spec.matrix = m;

  const points = vertices.map(v => transform(m, v));
  const selected = new Map();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    let best = points[0], score = -Infinity;
    for (const p of points) { const q = p[0] * x + p[1] * y + p[2] * z; if (q > score) { best = p; score = q; } }
    selected.set(best.join(','), best);
  }
  const hull = [...selected.values()].map(p => p.map(v => +v.toFixed(7)));
  const world = new R.World({ x: 0, y: 0, z: 0 });
  const desc = R.ColliderDesc.convexHull(new Float32Array(hull.flat()));
  if (!desc) throw new Error(spec.id + ' hull failed');
  const c = world.createCollider(desc.setDensity(materials[spec.material].density));
  const volume = c.volume(), mass = c.mass();
  world.free();

  const bounds = minMax(points);
  const weak = points.reduce((best, p) => (p[0] > best[0] ? p : best), points[0]);

  // 减面版几何略有出入，按它自己的顶点算期望包围盒；高模版就是 bounds。
  const liteGlb = readGlb(await fs.readFile(path.join(here, spec.lite)));
  const liteExpect = minMax(collectVertices(liteGlb.g, liteGlb.bin).map(v => transform(m, v)));

  files.push(await build(spec, 'pbr', spec.pbr, bounds));
  files.push(await build(spec, 'lite', path.join(here, spec.lite), liteExpect));

  entries.push({
    id: spec.id, name: spec.name, glb: `data/lux3d/${spec.id}.glb`, scale: 1, material: spec.material, tag: spec.tag,
    hull, bounds, weakPoint: { pos: weak.map(v => +v.toFixed(7)), radius: Math.max(0.035, spec.length * 0.13) },
    stats: { hp: spec.hp, attack: spec.attack, defense: spec.defense },
    volume, mass,
    source: { url: 'https://www.aholo3d.cn/ (Aholo Lux3D 生成)', author: 'Wren / Aholo Lux3D', license: '本人生成，按 Aholo 黑客松条款使用', sourceSha256: hash(pbrRaw) },
    normalization: { sourceBounds: { min: lo, max: hi }, matrix: m, sourceVertices: vertices.length },
  });
  console.log(spec.id, 'bounds min', bounds.min.map(v => v.toFixed(3)).join(','), 'max', bounds.max.map(v => v.toFixed(3)).join(','),
    'lite ext', [0, 1, 2].map(k => (liteExpect.max[k] - liteExpect.min[k]).toFixed(3)).join('x'),
    'hull', hull.length, 'mass', mass.toFixed(3), 'verts', vertices.length);
}
await fs.writeFile(path.join(here, 'catalog-entries.json'), JSON.stringify(entries, null, 2) + '\n');
await fs.writeFile(path.join(here, 'files.json'), JSON.stringify(files, null, 2) + '\n');
console.log('wrote catalog-entries.json + files.json');
for (const f of files) console.log(' ', f.file, (f.bytes / 1e6).toFixed(2) + 'MB', 'texture=' + f.hasTexture, 'drift=' + f.verifyDrift.toExponential(1));
