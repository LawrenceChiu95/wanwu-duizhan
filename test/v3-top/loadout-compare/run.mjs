// nice -n 20 node test/v3-top/loadout-compare/run.mjs [seeds=100] [output=results]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, open, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {simulateV3} from '../../../sim/v3.js';
import {BASE, PAIRS, LAYOUTS, CONDITIONS, options, sha256, summarizeReplay, aggregate} from './compare.mjs';

const seeds = Number(process.argv[2] ?? 100);
assert(Number.isInteger(seeds) && seeds > 0);
const dir = new URL(`${process.argv[3] ?? 'results'}/`, import.meta.url);
const root = new URL('../../../', import.meta.url);
const git = (...args) => execFileSync('git', ['-C', fileURLToPath(root), ...args], {encoding: 'utf8'}).trim();
git('diff', '--exit-code', BASE, '--', 'sim', 'web', 'data');
const sources = Object.fromEntries(await Promise.all(git('ls-tree', '-r', '--name-only', BASE, '--', 'sim', 'web', 'data').split('\n').map(async f => [f, sha256(await readFile(new URL(f, root)))])));
// Freeze both the page's opponent and its accepted URL scheme; no parameter overrides.
const page = await readFile(new URL('web/src/main.js', root), 'utf8');
assert(page.includes("const FOE = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'}"));
assert(page.includes("q.get('seed')") && page.includes("q.get('mine')"));
const inputs = {base: BASE, mode: 'A', pairs: PAIRS, layouts: LAYOUTS, conditions: CONDITIONS, seeds, sources};
await mkdir(dir, {recursive: true});
// Exclusive creation prevents accidental overwrite or mixing results from two runs.
const raw = await open(new URL('rounds.ndjson', dir), 'wx');
await writeFile(new URL('inputs.json', dir), JSON.stringify({...inputs, inputSha256: sha256(inputs), node: process.version, nice: execFileSync('ps', ['-o', 'nice=', '-p', String(process.pid)], {encoding: 'utf8'}).trim()}, null, 2) + '\n');
const rows = [], started = performance.now(), total = PAIRS.length * LAYOUTS.length * CONDITIONS.length * seeds;
try {
  for (const condition of CONDITIONS) for (const pair of PAIRS) for (const layout of LAYOUTS) {
    for (let seed = 1; seed <= seeds; seed++) {
      const t0 = performance.now(), replay = await simulateV3(options(pair, layout, condition, seed));
      const row = summarizeReplay(replay, {pair, layout, condition, computeMs: performance.now() - t0});
      rows.push(row); await raw.write(JSON.stringify(row) + '\n');
    }
    const progress = {complete: rows.length, total, seconds: (performance.now() - started) / 1000, condition, pair: pair.id, layout: layout.id};
    await writeFile(new URL('progress.json', dir), JSON.stringify(progress, null, 2) + '\n');
    console.log(JSON.stringify(progress));
  }
} finally {await raw.close();}
const summary = {...aggregate(rows, seeds), seconds: (performance.now() - started) / 1000, inputSha256: sha256(inputs)};
await writeFile(new URL('summary.json', dir), JSON.stringify(summary, null, 2) + '\n');
const columns = ['condition', 'pair', 'layout', 'games', 'wins', 'losses', 'draws', 'timeouts', 'winRate', 'secondsMean', 'secondsMedian', 'ownCoreContactsMedian', 'foeCoreContactsMedian', 'ownCoreAttackHitsMedian', 'foeCoreAttackHitsMedian', 'firstBreak'];
const csv = [columns.join(','), ...summary.cells.map(c => [c.condition, c.pair, c.layout, c.games, c.wins, c.losses, c.draws, c.timeouts, c.winRate, c.duration.mean, c.duration.median, c.core[0].contacts.median, c.core[1].contacts.median, c.core[0].attackHits.median, c.core[1].attackHits.median, JSON.stringify(c.firstBreak)].map(x => `"${String(x).replaceAll('"', '""')}"`).join(','))].join('\n') + '\n';
await writeFile(new URL('summary.csv', dir), csv);
console.log(JSON.stringify({complete: rows.length, seconds: summary.seconds, pass: summary.pass, conditions: summary.conditions, comparisons: summary.comparisons}));
