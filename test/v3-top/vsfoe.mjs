// 每种装法对网页固定对手的胜率（多种子），用来挑对手和默认装法。
// Usage: nice -n 20 node test/v3-top/vsfoe.mjs [seeds=3] ['item,orient,item,orient,spread' 对手，默认用网页的]
import {simulateV3} from '../../sim/v3.js';
import {LOADOUTS, FOE} from './loadouts.mjs';
const seeds = Number(process.argv[2] ?? 3), arg = process.argv[3]?.split(',');
const foe = arg ? {parts: [{item: arg[0], mount: 'e0', orient: arg[1]}, {item: arg[2], mount: arg[4], orient: arg[3]}]} : FOE;
const key = l => l.parts.map(p => `${p.item}:${p.orient}`).join('+') + '@' + l.parts[1].mount;
const out = [];
for (const l of LOADOUTS) {
  let w = 0, dur = 0;
  for (let s = 1; s <= seeds; s++) { const r = await simulateV3({fighters: [l, foe], mode: 'A', seed: 1000 + s}); w += r.meta.winner === 0 ? 1 : r.meta.winner === null ? .5 : 0; dur += r.meta.duration; }
  out.push({k: key(l), win: w / seeds, dur: +(dur / seeds).toFixed(1)});
}
out.sort((a, b) => b.win - a.win);
const hist = {}; for (const o of out) hist[o.win] = (hist[o.win] ?? 0) + 1;
if (process.env.ALL) console.error(JSON.stringify(out));
console.log(JSON.stringify({foe: key(foe), mean: +(out.reduce((s, o) => s + o.win, 0) / out.length).toFixed(3), hist, default: out.find(o => o.k === 'pan-lux3d:out+pillow:hug@e180'), top: out.slice(0, 8), bottom: out.slice(-5)}, null, 1));
