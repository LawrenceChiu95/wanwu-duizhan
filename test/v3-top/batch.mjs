// 陀螺版批量：随机装法对随机装法（含网页的固定对手），多种子。
// Usage: nice -n 20 node test/v3-top/batch.mjs [games=200] [mode=A]   RULES='{"core":{"hp":180}}' 临时覆盖参数
// MANUAL=1：手动模式，两边都用电脑的冲/挡规则（同一种子结果固定），文件名带 -manual。
// SAVE=1 写 batch-<mode>.json（逐局）和 summary-<mode>.json。
import {simulateV3} from '../../sim/v3.js';
import {simulateWithRules} from './variant.mjs';
import {metrics, median} from '../v3/probe.mjs';
import {random} from '../../sim/math.js';
import {writeFile, mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {OFFER, FOE, LOADOUTS} from './loadouts.mjs';
export {OFFER, FOE, LOADOUTS};
const games = Number(process.argv[2] ?? 200), mode = process.argv[3] ?? 'A';
const sim = process.env.RULES ? await simulateWithRules(JSON.parse(process.env.RULES)) : simulateV3;
// MANUAL=mash：玩家一方换成「死按」脚本（冲每 4.6 秒按一次、挡每 5.2 秒按一次，冷却中按了不算），对面仍是电脑。
const mash = [];
for (let k = 60; k < 7200; k += 552) mash.push({step: k, side: 0, action: 'dash'});
for (let k = 300; k < 7200; k += 624) mash.push({step: k, side: 0, action: 'block'});
const manual = process.env.MANUAL === 'mash' ? {sides: ['input', 'ai'], inputs: mash.sort((a, b) => a.step - b.step)} : process.env.MANUAL ? {sides: ['ai', 'ai']} : null;
const tag = manual ? `${mode}-manual${process.env.MANUAL === 'mash' ? '-mash' : ''}` : mode;
const pick = random(20261027), rows = [], t0 = performance.now();
for (let g = 0; g < games; g++) {
  // Every fourth game is someone against the page's fixed opponent.
  const a = LOADOUTS[Math.floor(pick() * LOADOUTS.length)], b = g % 4 === 3 ? FOE : LOADOUTS[Math.floor(pick() * LOADOUTS.length)];
  const seed = g + 1, r = await sim({fighters: [a, b], mode, seed, manual}), m = metrics(r);
  const hits = r.events.filter(e => (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' && e.damage > 0);
  const d = r.meta.diagnostics, contacts = r.events.filter(e => e.type === 'contact');
  // Spin about each body's own up axis, sampled every recorded frame (rad/s).
  const spins = r.frames.flatMap(fr => fr.fighters.map(f => { const [x, y, z, w] = f.quat, up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]; return up[0] * f.angularVelocity[0] + up[1] * f.angularVelocity[1] + up[2] * f.angularVelocity[2]; }));
  rows.push({g, seed, a, b, ...m, coreHits: hits.filter(e => e.targetPart === 'core').length, partHits: hits.filter(e => e.targetPart !== 'core').length,
    firstBreak: r.events.find(e => e.type === 'break')?.t ?? null, contacts: contacts.length, closingMedian: median(contacts.map(e => e.closingSpeed)),
    maxCorrection: d.maxPositionCorrection, maxPenetration: d.maxGeometricPenetration, residual: d.maxResidualPenetration, correctionSteps: d.correctionSteps,
    ...(manual && {presses: r.events.filter(e => e.type === 'press').length, dashes: r.events.filter(e => e.type === 'dash' && e.phase === 'go').length, dashHits: r.events.filter(e => e.type === 'dash' && e.outcome === 'hit').length, parries: r.events.filter(e => e.type === 'parry').length, dashMiss: r.events.filter(e => e.type === 'dash' && e.outcome === 'miss').length, blocks: r.events.filter(e => e.type === 'block').length, dashDamage: r.events.filter(e => e.dash && e.role === 'attack').reduce((n, e) => n + e.damage, 0), damage: r.events.filter(e => e.role === 'attack').reduce((n, e) => n + e.damage, 0), dashKo: Boolean(r.decisive.why?.dash)}),
    zoneDamage: d.zoneDamage, spinMedian: median(spins), spinP10: [...spins].sort((x, y) => x - y)[Math.floor(spins.length * .1)], why: r.decisive.why && {attackerOrient: r.decisive.why.attackerOrient, loserPartsLeft: r.decisive.why.loserPartsLeft}});
}
const seconds = (performance.now() - t0) / 1000;
const pass = r => r.duration >= 20 && r.duration <= 40 && r.first !== null && r.first <= 1.5 && r.medianGap !== null && r.medianGap <= 3 && r.longestGap !== null && r.longestGap <= 6;
const share = (f, rs = rows) => rs.filter(f).length;
const q = (xs, p) => { const s = xs.filter(x => x !== null).sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : null; };
// Win rate: games won / games played, by item, by orientation of that item, by spread; draws count as half.
const tally = new Map();
const add = (key, res) => { const t = tally.get(key) ?? {games: 0, wins: 0, draws: 0}; t.games++; if (res === 1) t.wins++; if (res === 0.5) t.draws++; tally.set(key, t); };
for (const r of rows) [r.a, r.b].forEach((f, i) => {
  const res = r.winner === null ? 0.5 : r.winner === i ? 1 : 0;
  for (const p of f.parts) { add(`item:${p.item}`, res); add(`item:${p.item}:${p.orient}`, res); }
  add(`orients:${f.parts.map(p => p.orient).sort().join('+')}`, res);
  add(`spread:${f.parts[1].mount}`, res);
  if (f === FOE) add('foe', res);
});
const rates = Object.fromEntries([...tally].sort().map(([k, t]) => [k, {games: t.games, winRate: +((t.wins + t.draws / 2) / t.games).toFixed(3)}]));
const sum = k => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
const summary = {mode, manual: Boolean(manual), games, seconds: +seconds.toFixed(1), rules: process.env.RULES ?? null,
  pass: share(pass), durationPass: share(r => r.duration >= 20 && r.duration <= 40), short: share(r => r.duration < 20), long: share(r => r.duration > 40), timeouts: share(r => r.reason === 'timeout'),
  firstPass: share(r => r.first !== null && r.first <= 1.5), medianGapPass: share(r => r.medianGap !== null && r.medianGap <= 3), longestGapPass: share(r => r.longestGap !== null && r.longestGap <= 6), tailOver6: share(r => r.tail > 6),
  duration: {p10: q(rows.map(r => r.duration), .1), median: q(rows.map(r => r.duration), .5), p90: q(rows.map(r => r.duration), .9)},
  first: {median: q(rows.map(r => r.first), .5), max: q(rows.map(r => r.first), 1)}, medianGap: {median: q(rows.map(r => r.medianGap), .5), max: q(rows.map(r => r.medianGap), 1)}, longestGap: {median: q(rows.map(r => r.longestGap), .5), max: q(rows.map(r => r.longestGap), 1)},
  hitsPerGame: q(rows.map(r => r.hits), .5), breaksPerGame: +(rows.reduce((n, r) => n + r.breaks, 0) / games).toFixed(2), gamesWithBreak: share(r => r.breaks > 0), coreHitShare: +(rows.reduce((n, r) => n + r.coreHits, 0) / rows.reduce((n, r) => n + r.coreHits + r.partHits, 0)).toFixed(3),
  scrape: {episodes: rows.reduce((n, r) => n + r.scrapeCount, 0), seconds: +rows.reduce((n, r) => n + r.scrapeDuration, 0).toFixed(2), longest: q(rows.map(r => r.maxScrapeDuration), 1)},
  slowDamage: rows.reduce((n, r) => n + r.zoneDamage, 0), maxCorrectionPerStep: q(rows.map(r => r.maxCorrection), 1), maxPenetration: {median: q(rows.map(r => r.maxPenetration), .5), max: q(rows.map(r => r.maxPenetration), 1)},
  ...(manual && {perGame: {presses: +(sum('presses') / games).toFixed(2), dashes: +(sum('dashes') / games).toFixed(2), dashHits: +(sum('dashHits') / games).toFixed(2), parries: +(sum('parries') / games).toFixed(2), dashMiss: +(sum('dashMiss') / games).toFixed(2), blocks: +(sum('blocks') / games).toFixed(2)}, dashDamageShare: +(sum('dashDamage') / sum('damage')).toFixed(3), dashKoGames: share(r => r.dashKo)}),
  closingMedian: q(rows.map(r => r.closingMedian), .5), spin: {median: q(rows.map(r => r.spinMedian), .5), p10: q(rows.map(r => r.spinP10), .5)}, rates,
  failures: rows.filter(r => !pass(r)).slice(0, 12).map(r => ({g: r.g, seed: r.seed, a: r.a.parts.map(p => `${p.item}/${p.orient}`).join('+') + '@' + r.a.parts[1].mount, b: r.b.parts.map(p => `${p.item}/${p.orient}`).join('+') + '@' + r.b.parts[1].mount, duration: +r.duration.toFixed(2), first: r.first, medianGap: r.medianGap && +r.medianGap.toFixed(2), longestGap: r.longestGap && +r.longestGap.toFixed(2), tail: +r.tail.toFixed(2), reason: r.reason, breaks: r.breaks}))};
if (process.env.SAVE) {
  const dir = new URL('./batch/', import.meta.url);
  await mkdir(dir, {recursive: true});
  await writeFile(new URL(`rounds-${tag}.json`, dir), JSON.stringify(rows));
  await writeFile(new URL(`summary-${tag}.json`, dir), JSON.stringify(summary, null, 2) + '\n');
}
const brief = {...summary, rates: Object.fromEntries(Object.entries(rates).filter(([k]) => !/:(out|hug)$/.test(k) || process.env.VERBOSE)), failures: process.env.VERBOSE ? summary.failures : summary.failures.slice(0, 4)};
console.log(JSON.stringify(brief, null, 1));
