import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ratingScores} from '../../sim/item-rating.js';
import {itemCombat, loadV3Rules} from '../../sim/v3.js';
import {ratingOf, byGrade} from '../../web/src/rating.js';
import {setNames, matchStats, tipLine} from '../../web/src/reason.js';
const catalog = JSON.parse(await readFile(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const rules = await loadV3Rules();
const broom = catalog.items.find(it => it.id === 'broom');
assert.ok(broom);
const bad = [undefined, {}, {scores: {}},
  ...['attack', 'range', 'durability'].flatMap(key => [
    {scores: Object.fromEntries(Object.entries(broom.rating.scores).filter(([k]) => k !== key))},
    ...[NaN, Infinity, -1, 101, '50', null].map(value => ({scores: {...broom.rating.scores, [key]: value}}))
  ])
];
test('missing or invalid stored scores are neutral on screen and fail combat with the named item', () => {
  for (const rating of bad) {
    const item = {...broom, rating};
    assert.equal(ratingScores(item), null);
    assert.equal(ratingOf(item), null);
    assert.throws(() => itemCombat(item, rules), /扫把.*broom.*缺评分或评分无效/);
    setNames([item]);
    const s = matchStats({events: [{type: 'dash', phase: 'end', side: 0, quality: 'full'}]},
      [{parts: [{item: item.id, orient: 'hug'}]}, {parts: []}]);
    assert.equal(s.hugAttacker, null);
    assert.ok(!tipLine(s, 1).includes('适合伸出'));
  }
  setNames([broom]);
});
test('valid stored scores are unchanged on screen and in combat, including zero and 100', () => {
  for (const value of [0, 100]) {
    const item = {...broom, rating: {...broom.rating, scores: {attack: value, range: value, durability: value}}};
    assert.equal(ratingScores(item), item.rating.scores);
    const shown = ratingOf(item), letter = value === 0 ? 'D' : 'S';
    assert.equal(shown.scores, item.rating.scores);
    assert.deepEqual(shown.letters, {attack: letter, range: letter, durability: letter});
    assert.equal(shown.grade, letter);
    const combat = itemCombat(item, rules), k = rules.top.itemStats;
    assert.equal(combat.hp, rules.attachmentHp * (k.hpBase + k.hpScale * value));
    assert.equal(combat.power, k.powerBase + k.powerScale * value);
  }
  assert.equal(itemCombat({id: '__core'}, rules).hp, rules.core.hp);
});
test('display corrects stale letters and grades from scores without mutating the item', () => {
  const cases = [
    [75, 75, 75, ['S', 'S', 'S'], 'S'],
    [60, 60, 60, ['A', 'A', 'A'], 'A'],
    [45, 45, 45, ['B', 'B', 'B'], 'B'],
    [30, 30, 30, ['C', 'C', 'C'], 'C'],
    [29, 29, 29, ['D', 'D', 'D'], 'D'],
    [99, 75, 50, ['S', 'S', 'B'], 'A']
  ];
  for (const [attack, range, durability, letters, grade] of cases) {
    for (const stored of [{}, {letters: {attack: 'D', range: 'D', durability: 'D'}, grade: 'S'}]) {
      const item = {rating: {version: 'fixture', scores: {attack, range, durability}, ...stored}};
      const original = structuredClone(item), shown = ratingOf(item);
      assert.deepEqual(shown.letters, {attack: letters[0], range: letters[1], durability: letters[2]});
      assert.equal(shown.grade, grade);
      assert.equal(shown.version, 'fixture');
      assert.equal(shown.scores, item.rating.scores);
      assert.deepEqual(item, original);
    }
  }
});
test('grade sorting uses the displayed score-derived grade, with unscored entries last', () => {
  const items = {
    high: {rating: {scores: {attack: 75, range: 75, durability: 75}, grade: 'D'}},
    low: {rating: {scores: {attack: 29, range: 29, durability: 29}, grade: 'S'}},
    missing: {}
  };
  assert.deepEqual(byGrade(['low', 'missing', 'high'], id => ratingOf(items[id])), ['high', 'low', 'missing']);
});
// Same isolated source-loading pattern as the existing rules variant: inject catalog data in memory only.
async function withCatalog(items) {
  let source = await readFile(new URL('../../sim/v3.js', import.meta.url), 'utf8');
  source = source.replaceAll("'@dimforge/rapier3d-compat'", JSON.stringify(new URL('../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url).href));
  for (const file of ['index.js', 'math.js']) source = source.replaceAll(`'./${file}'`, JSON.stringify(new URL(`../../sim/${file}`, import.meta.url).href));
  source = source.replace("new URL('./v3-rules.json',import.meta.url)", `new URL(${JSON.stringify(new URL('../../sim/v3-rules.json', import.meta.url).href)})`);
  const target = 'const c=await loadCatalogRules(),r=await loadV3Rules();';
  assert.equal(source.split(target).length, 2);
  source = source.replace(target, target + `c.items=${JSON.stringify(items)};`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
test('both fighter selections reject a missing or partial rating at match entry', async () => {
  for (const rating of [undefined, {scores: {attack: 50, durability: 50}}, {scores: {...broom.rating.scores, range: 101}}]) {
    const {createV3Match} = await withCatalog(catalog.items.map(it => it.id === broom.id ? {...it, rating} : it));
    for (const side of [0, 1]) {
      const fighters = [{parts: []}, {parts: []}];
      fighters[side].parts.push({item: broom.id, mount: 'e0', orient: 'out'});
      await assert.rejects(createV3Match({fighters, seed: 1}), /扫把.*broom.*缺评分或评分无效/);
    }
  }
});
test('an unselected bad entry does not block a valid selection', async () => {
  const items = structuredClone(catalog.items);delete items.find(it => it.id === 'broom').rating;
  const {createV3Match} = await withCatalog(items);
  const m = await createV3Match({fighters: [{parts: [{item: 'pillow', mount: 'e0', orient: 'hug'}]}, {parts: []}], seed: 1});
  try {assert.ok(m.initial[0].parts[0].maxHp > 0);} finally {m.free();}
});
