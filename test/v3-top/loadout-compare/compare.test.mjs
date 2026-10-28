import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReplay, wilson, aggregate, PAIRS, LAYOUTS, CONDITIONS} from './compare.mjs';

test('one contact with recoil is counted once per core, and simultaneous first breaks are retained', () => {
  const replay = {meta: {seed: 7, winner: null, reason: 'timeout', duration: 60}, decisive: {why: null}, events: [
    {type: 'hit', t: 1, target: 0, targetPart: 'core', role: 'attack', damage: 12},
    {type: 'hit', t: 1, target: 0, targetPart: 'core', role: 'recoil', damage: 1},
    {type: 'hit', t: 2, target: 0, targetPart: 'part-0', role: 'attack', damage: 9},
    {type: 'hit', t: 3, target: 1, targetPart: 'core', role: 'recoil', damage: 2},
    {type: 'break', t: 4, target: 0, targetPart: 'part-0', item: 'broom', orient: 'out'},
    {type: 'break', t: 4, target: 1, targetPart: 'part-1', item: 'lamp-lux3d', orient: 'hug'}
  ]};
  const r = summarizeReplay(replay, {pair: PAIRS[0], layout: LAYOUTS[0], condition: 'auto', computeMs: 0});
  assert.deepEqual(r.core.map(c => [c.contacts, c.attackHits, c.recoilHits, c.damage]), [[1, 1, 1, 13], [1, 0, 1, 2]]);
  assert.equal(r.firstBreak.broken.length, 2);
  assert.equal(r.firstBreakBySide[0].broken[0].item, 'broom');
  assert.equal(r.winner, null);
});

test('no broken part stays explicitly none, not a fabricated first part', () => {
  const r = summarizeReplay({meta: {seed: 1, winner: 0, reason: 'ko', duration: 20}, decisive: {why: null}, events: []},
    {pair: PAIRS[0], layout: LAYOUTS[0], condition: 'auto', computeMs: 0});
  assert.equal(r.firstBreak, null);
  assert.deepEqual(r.firstBreakBySide, [null, null]);
});

test('small seed samples retain uncertainty even at 0 or 100 percent', () => {
  const none = wilson(0, 100), all = wilson(100, 100);
  assert(Math.abs(none[0]) < 1e-12);
  assert(none[1] > .03 && none[1] < .04);
  assert(all[0] > .96 && all[0] < .97);
  assert(Math.abs(all[1] - 1) < 1e-12);
});

test('shared tied best layout blocks the pass, and missing seeds cannot be silently counted', () => {
  const rows = CONDITIONS.flatMap(condition => PAIRS.flatMap(pair => LAYOUTS.flatMap((layout, i) => [1, 2].map(seed => ({
    condition, pair: pair.id, layout: layout.id, seed,
    winner: i === 0 ? 0 : i === 1 ? null : 1, reason: i === 1 ? 'timeout' : 'ko', duration: 20,
    firstBreak: null, firstBreakBySide: [null, null],
    core: [0, 1].map(() => ({contacts: 2, attackHits: 1, recoilHits: 1, damage: 20})),
    actions: [0, 1].map(() => ({dash: 1, block: 1, parry: 0}))
  })))));
  const s = aggregate(rows, 2);
  assert.equal(s.pass, false);
  assert(s.conditions.every(c => c.allSpreadsPass));
  assert.deepEqual(s.conditions[0].universalBest, [LAYOUTS[0].id]);
  assert.equal(s.cells[1].winRate, 0);
  assert.equal(s.cells[1].draws, 2);
  const duplicate = structuredClone(rows);
  duplicate[1].seed = 1;
  assert.throws(() => aggregate(duplicate, 2));
});
