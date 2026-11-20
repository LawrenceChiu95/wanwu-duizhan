// 首页示范件「剪刀」 (远夏 e0fe9b09, Elara f9fb590d): from the photo library's model.glb, the files data/showcase/scissors
// holds, worked out only, nothing generated. Usage: node tools/import-item/showcase-scissors.mjs <library model.glb> <library item.json>
// 1. model.glb: the same mesh under one new root node「upright」. The library's file lies across x-y on a slant, so its
//    real length came out 24 cm, not the 18 cm the item says; the node turns its length (the principal axis of its
//    vertices) onto y, blade tip down, its broad side to -x (the opening page's camera, potview.js) so every side is on
//    an axis for the fight's mount (sim/v3.js itemAxes), scales the length to standardLongSide and centres it.
// 2. item.json: the library item with hull, bounds, volume and weak point worked out again from that model.glb the way
//    mesh.mjs prepareMesh does (the farthest vertex each of 26 directions, Rapier's convex hull for the volume; weak
//    point at the outward end), so what the fight collides with is this model as it stands. id showcase-scissors.
// 3. hull.json: those hull points for 看碰撞体, in the same metres the model loads in.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import RAPIER from '@dimforge/rapier3d-compat';
import {sha256} from './mesh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), DIR = path.join(ROOT, 'data/showcase/scissors');
const [srcGlb, srcItem] = process.argv.slice(2);
const item = JSON.parse(await fs.readFile(srcItem, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(new Uint8Array(await fs.readFile(srcGlb)));
const world = () => {
  const pts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), m = node.getWorldMatrix();
    for (const prim of mesh?.listPrimitives() ?? []) {
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) { const [x, y, z] = pos.getElement(i, []); pts.push([0, 1, 2].map(r => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r])); }
    }
  }
  return pts;
};
const mul = (p, q) => [p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1], p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0], p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3], p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2]];
const about = (axis, a) => Object.assign([0, 0, 0, Math.cos(a / 2)], {[axis]: Math.sin(a / 2)});
const spread = (pts, i, j) => {
  const ci = pts.reduce((s, p) => s + p[i], 0) / pts.length, cj = pts.reduce((s, p) => s + p[j], 0) / pts.length;
  let ii = 0, jj = 0, ij = 0;
  for (const p of pts) { const a = p[i] - ci, b = p[j] - cj; ii += a * a; jj += b * b; ij += a * b; }
  return {ci, cj, angle: 0.5 * Math.atan2(2 * ij, ii - jj)};
};

let pts = world();
// Its length in x-y (z is already its thin side there); the tip is the end farther from the centre of the vertices.
const {ci, cj, angle} = spread(pts, 0, 1), along = p => (p[0] - ci) * Math.cos(angle) + (p[1] - cj) * Math.sin(angle);
const lo = Math.min(...pts.map(along)), hi = Math.max(...pts.map(along)), tip = -lo > hi ? angle + Math.PI : angle;
const turn = -Math.PI / 2 - tip;
const turned = pts.map(p => [p[0] * Math.cos(turn) - p[1] * Math.sin(turn), 0, p[2]]), broad = spread(turned, 0, 2).angle;
const root = doc.createNode('upright').setRotation(mul(about(1, -Math.PI / 2), mul(about(1, broad), about(2, turn))));
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
scene.addChild(root);
pts = world();
let min = [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))), max = [0, 1, 2].map(k => Math.max(...pts.map(p => p[k])));
const s = item.standardLongSide / (max[1] - min[1]);
root.setScale([s, s, s]).setTranslation([0, 1, 2].map(k => -s * (min[k] + max[k]) / 2));
const glb = await io.writeBinary(doc);
await fs.writeFile(path.join(DIR, 'model.glb'), glb);

pts = world();
min = [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))); max = [0, 1, 2].map(k => Math.max(...pts.map(p => p[k])));
const supports = new Map();
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (!x && !y && !z) continue;
  let best = pts[0], score = -Infinity;
  for (const p of pts) { const v = x * p[0] + y * p[1] + z * p[2]; if (v > score) { score = v; best = p; } }
  supports.set(best.join(','), best);
}
const hull = [...supports.values()];
await RAPIER.init();
const physics = new RAPIER.World({x: 0, y: 0, z: 0});
let volume;
try { volume = physics.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(hull.flat())).setMass(item.mass)).volume(); } finally { physics.free(); }
const spans = max.map((v, k) => v - min[k]), long = spans.indexOf(Math.max(...spans)), out = item.outEnd ?? 1;
const weak = pts.reduce((a, p) => p[long] * out > a[long] * out ? p : a);
Object.assign(item, {id: 'showcase-scissors', hull, bounds: {min, max}, volume, weakPoint: {...item.weakPoint, pos: weak}});
await fs.writeFile(path.join(DIR, 'item.json'), `${JSON.stringify(item, null, 1)}\n`);
const points = hull.map(p => p.map(v => Number(v.toFixed(6))));
await fs.writeFile(path.join(DIR, 'hull.json'), `${JSON.stringify({model: 'data/showcase/scissors/model.glb', modelSha256: sha256(glb), category: '剪刀',
  hullPoints: points.length, volumeLitres: Number((volume * 1000).toFixed(3)), points})}\n`);
console.log(JSON.stringify({size: spans.map(v => +(v * 100).toFixed(1)), hullPoints: hull.length, volumeLitres: +(volume * 1000).toFixed(3), weak: weak.map(v => +v.toFixed(4))}));
