// 首页「看碰撞体」 (Elara 742f4a4a): the collision shell the fight would give 首页's 奶锅, written to
// data/showcase/pot/hull.json in that model.glb's own coordinates so potview.js can draw it on the pot as it stands.
// The pot is not in the roster, so the shell comes from the importer's own prepareMesh, the one `cli.mjs glb --category
// pot` runs (the same import 「上场对撞」's picture was shot with): its support points, taken back out of the item frame
// (normalization.matrix). Only reads the catalog. Usage: node tools/import-item/showcase-hull.mjs   (again after model.glb changes)
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readGlb, prepareMesh, sha256} from './mesh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const glb = path.join(ROOT, 'data/showcase/pot/model.glb'), out = path.join(ROOT, 'data/showcase/pot/hull.json');
const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'data/catalog.json'), 'utf8'));
const template = catalog.items.find(i => i.category === 'pot' && !i.generated && !i.comparisonBase), standard = catalog.itemStandards.pot;
const raw = await readGlb(glb), {shape} = await prepareMesh(raw, template, standard);

// matrix (column-major) is a scaled rotation plus a shift: raw = R^T (p - t) / s, with s from any column's length.
const m = shape.normalization.matrix, s = Math.hypot(m[0], m[1], m[2]), t = [m[12], m[13], m[14]];
const back = p => [0, 1, 2].map(c => [0, 1, 2].reduce((sum, r) => sum + m[c * 4 + r] * (p[r] - t[r]), 0) / (s * s));
const points = shape.hull.map(back).map(p => p.map(v => Number(v.toFixed(6))));
await fs.writeFile(out, `${JSON.stringify({model: 'data/showcase/pot/model.glb', modelSha256: sha256(raw), category: 'pot',
  hullPoints: points.length, volumeLitres: Number((shape.volume * 1000).toFixed(3)), points})}\n`);
console.log(`${points.length} points -> ${path.relative(ROOT, out)}`);
