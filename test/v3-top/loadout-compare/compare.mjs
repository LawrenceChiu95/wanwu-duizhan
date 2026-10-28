import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FOE} from '../loadouts.mjs';

export const BASE = 'd08a698f7bc8c710279afc6929418bf5858448ed';
export const PAIRS = [
  {id: 'pan-broom', label: 'Lux3D锅＋扫把', items: ['pan-lux3d', 'broom']},
  {id: 'scissors-pillow', label: '剪刀＋枕头', items: ['scissors', 'pillow']},
  {id: 'lamp-slipper', label: 'Lux3D台灯＋拖鞋', items: ['lamp-lux3d', 'slipper']}
];
export const LAYOUTS = ['out', 'hug'].flatMap(a => ['out', 'hug'].flatMap(b => ['e180', 'e90'].map(spread => ({
  id: `${a}-${b}-${spread}`, orients: [a, b], spread
}))));
export const CONDITIONS = ['auto', 'ai-ai'];
export const opponent = structuredClone(FOE);
export const fighter = (pair, layout) => ({parts: pair.items.map((item, i) => ({item, mount: i ? layout.spread : 'e0', orient: layout.orients[i]}))});
export const options = (pair, layout, condition, seed) => ({fighters: [fighter(pair, layout), opponent], mode: 'A', seed,
  manual: condition === 'auto' ? null : {sides: ['ai', 'ai']}});
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest('hex');
export const median = xs => {if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;};
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const counts = xs => Object.fromEntries([...new Set(xs)].sort().map(x => [x, xs.filter(y => y === x).length]));
const breakFact = e => ({side: e.target, part: e.targetPart, item: e.item, orient: e.orient});
const firstBreak = es => es.length ? {t: es[0].t, broken: es.filter(e => e.t === es[0].t).map(breakFact)} : null;
export function summarizeReplay(replay, {pair, layout, condition, computeMs}) {
  const {events, meta} = replay;
  const broken = events.filter(e => e.type === 'break');
  const damage = events.filter(e => ['hit', 'weak'].includes(e.type) && e.damage > 0);
  const core = [0, 1].map(side => {
    const es = damage.filter(e => e.target === side && e.targetPart === 'core');
    return {contacts: new Set(es.map(e => e.t)).size, attackHits: es.filter(e => e.role === 'attack').length,
      recoilHits: es.filter(e => e.role === 'recoil').length, damage: es.reduce((n, e) => n + e.damage, 0), first: es[0]?.t ?? null};
  });
  const actions = [0, 1].map(side => ({
    dash: events.filter(e => e.type === 'dash' && e.phase === 'go' && e.side === side).length,
    block: events.filter(e => e.type === 'block' && e.side === side).length,
    parry: events.filter(e => e.type === 'parry' && e.target === side).length
  }));
  return {pair: pair.id, layout: layout.id, condition, seed: meta.seed, winner: meta.winner, reason: meta.reason,
    duration: meta.duration, computeMs, firstBreak: firstBreak(broken), firstBreakBySide: [0, 1].map(side => firstBreak(broken.filter(e => e.target === side))),
    breaks: broken.map(e => ({t: e.t, ...breakFact(e)})), core, actions,
    decisive: replay.decisive.why, replaySha256: sha256(replay)};
}
// Draws (including timeouts) stay in the denominator and are not counted as wins.
export function wilson(wins, n) {
  const z = 1.959963984540054, p = wins / n, den = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / den, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const breakKey = fact => fact ? fact.broken.map(e => `${e.side}:${e.item}`).sort().join(' & ') : 'none';
export function aggregate(rows, seeds) {
  assert.equal(rows.length, PAIRS.length * LAYOUTS.length * CONDITIONS.length * seeds);
  const cells = [], comparisons = [];
  for (const condition of CONDITIONS) for (const pair of PAIRS) {
    const pairCells = [];
    for (const layout of LAYOUTS) {
      const rs = rows.filter(r => r.condition === condition && r.pair === pair.id && r.layout === layout.id);
      assert.deepEqual(rs.map(r => r.seed).sort((a, b) => a - b), Array.from({length: seeds}, (_, i) => i + 1));
      const wins = rs.filter(r => r.winner === 0).length;
      const c = {pair: pair.id, layout: layout.id, condition, games: rs.length, wins, losses: rs.filter(r => r.winner === 1).length,
        draws: rs.filter(r => r.winner === null).length, timeouts: rs.filter(r => r.reason === 'timeout').length,
        winRate: wins / rs.length, winRate95: wilson(wins, rs.length), duration: {mean: mean(rs.map(r => r.duration)), median: median(rs.map(r => r.duration))},
        firstBreak: counts(rs.map(r => breakKey(r.firstBreak))),
        firstOwnBreak: counts(rs.map(r => breakKey(r.firstBreakBySide[0]))), firstFoeBreak: counts(rs.map(r => breakKey(r.firstBreakBySide[1]))),
        core: [0, 1].map(side => Object.fromEntries(['contacts', 'attackHits', 'recoilHits', 'damage'].map(k => [k, {mean: mean(rs.map(r => r.core[side][k])), median: median(rs.map(r => r.core[side][k]))}]))),
        actions: [0, 1].map(side => Object.fromEntries(['dash', 'block', 'parry'].map(k => [k, mean(rs.map(r => r.actions[side][k]))])))};
      cells.push(c); pairCells.push(c);
    }
    const bestRate = Math.max(...pairCells.map(c => c.winRate)), worstRate = Math.min(...pairCells.map(c => c.winRate));
    const best = pairCells.filter(c => c.winRate === bestRate).map(c => c.layout), worst = pairCells.filter(c => c.winRate === worstRate).map(c => c.layout);
    comparisons.push({condition, pair: pair.id, best, worst, bestRate, worstRate, spread: bestRate - worstRate,
      pass: bestRate - worstRate >= 0.2 - 1e-12});
  }
  const conditions = CONDITIONS.map(condition => {
    const cs = comparisons.filter(c => c.condition === condition);
    const universalBest = cs[0].best.filter(id => cs.every(c => c.best.includes(id)));
    return {condition, pass: cs.every(c => c.pass) && !universalBest.length, allSpreadsPass: cs.every(c => c.pass), universalBest};
  });
  return {games: rows.length, seedsPerCell: seeds, cells, comparisons, conditions, pass: conditions.every(c => c.pass)};
}
