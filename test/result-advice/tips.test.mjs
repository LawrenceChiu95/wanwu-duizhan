import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setNames, matchStats, tipLine} from '../../web/src/reason.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url)));
setNames(catalog.items);

function stats(item, orient = 'out') {
  return matchStats({events: [
    {type: 'dash', phase: 'end', side: 0, quality: 'full'},
    {type: 'break', target: 0, targetPart: 'part-0', item}
  ]}, [{parts: [{item, orient}]}, {parts: []}]);
}

test('both real broom items keep their range after an out piece breaks', () => {
  const brooms = catalog.items.filter(it => it.category === 'broom' && it.rating);
  assert.equal(brooms.length, 2);
  for (const it of brooms) {
    const tip = tipLine(stats(it.id), 1);
    assert.ok(tip.includes(it.name));
    assert.ok(tip.includes('按挡'));
    assert.ok(!tip.includes('改成贴着'));
  }
});

test('a real range item held close suggests moving it out', () => {
  const broom = catalog.items.find(it => it.category === 'broom' && it.rating);
  assert.equal(tipLine(stats(broom.id, 'hug'), 1), `${broom.name}适合伸出，换另一件贴着`);
});

test('a defensive pillow can still move from out to hug', () => {
  assert.equal(tipLine(stats('pillow'), 1), '先碎的是伸出的枕头，试试把它改成贴着');
});

test('same category follows the individual scores, including attack specialists', () => {
  setNames([
    {id: 'tip-range', name: '长件', category: 'broom', rating: {scores: {attack: 30, range: 90, durability: 50}}},
    {id: 'tip-guard', name: '厚件', category: 'broom', rating: {scores: {attack: 30, range: 50, durability: 90}}},
    {id: 'tip-attack', name: '硬件', category: 'broom', rating: {scores: {attack: 90, range: 30, durability: 50}}}
  ]);
  assert.ok(tipLine(stats('tip-range'), 1).includes('按挡'));
  assert.ok(tipLine(stats('tip-attack'), 1).includes('按挡'));
  assert.ok(tipLine(stats('tip-guard'), 1).includes('改成贴着'));
  assert.ok(tipLine(stats('tip-attack', 'hug'), 1).includes('适合伸出'));
  assert.ok(!tipLine(stats('tip-guard', 'hug'), 1).includes('适合伸出'));
});

test('equal scores and absent scores never invent an orientation preference', () => {
  setNames([
    {id: 'tip-equal', name: '均衡件', rating: {scores: {attack: 60, range: 30, durability: 60}}},
    {id: 'tip-unknown', name: '未知件'}
  ]);
  for (const id of ['tip-equal', 'tip-unknown']) {
    assert.ok(tipLine(stats(id), 1).includes('按挡'));
    assert.ok(!tipLine(stats(id, 'hug'), 1).includes('适合伸出'));
  }
});

test('wins and the no-input tutorial retain priority over item advice', () => {
  assert.equal(tipLine(stats('pillow'), 0), '赢了。试试换个装法，看能不能赢得更快');
  const s = stats('pillow');
  s.presses = 0;
  assert.equal(tipLine(s, 1), '按冲朝它扑过去，它冲过来时按挡');
});

test('two real broom attackers never tell the player to swap them back and forth', () => {
  for (const [hug, out] of [['broom', 'wasteland-broom'], ['wasteland-broom', 'broom']]) {
    const s = matchStats({events: [
      {type: 'dash', phase: 'end', side: 0, quality: 'full'},
      {type: 'break', target: 0, targetPart: 'part-0', item: hug}
    ]}, [{parts: [{item: hug, orient: 'hug'}, {item: out, orient: 'out'}]}, {parts: []}]);
    assert.equal(s.hugAttacker, null);
    assert.equal(tipLine(s, 1), '它冲过来时按挡，能把它弹开');
  }
});

test('orientation tolerance includes five points in either direction; six points can prefer attack, range or guard', () => {
  for (const offense of ['attack', 'range']) {
    for (const gap of [-6, -5, -1, 0, 1, 5, 6]) {
      const id = `tolerance-${offense}-${gap}`;
      const scores = {attack: 20, range: 20, durability: 60};
      scores[offense] = 60 + gap;
      setNames([{id, name: '测试件', rating: {scores}}]);
      assert.equal(tipLine(stats(id), 1).includes('改成贴着'), gap < -5, `${offense} gap ${gap}, out`);
      assert.equal(tipLine(stats(id, 'hug'), 1).includes('适合伸出'), gap > 5, `${offense} gap ${gap}, hug`);
    }
  }
});

test('only two effective blocks suppress repeated block-timing advice and continue later tips', () => {
  const broom = catalog.items.find(it => it.category === 'broom' && it.rating);
  for (const perfect of [0, 1, 2, 3]) {
    const events = [
      ...Array.from({length: 3}, () => ({type: 'dash', phase: 'end', side: 0, quality: 'miss'})),
      {type: 'break', target: 0, targetPart: 'part-0', item: broom.id},
      ...Array.from({length: 5}, () => ({type: 'blockResult', side: 0, outcome: 'empty'})),
      {type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: false},
      {type: 'blockResult', side: 1, outcome: 'perfect', damageApplied: true},
      ...Array.from({length: perfect}, () => ({type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: true}))
    ];
    const s = matchStats({events}, [{parts: [{item: broom.id, orient: 'out'}]}, {parts: []}]);
    assert.equal(s.perfect, perfect);
    assert.equal(tipLine(s, 1), perfect < 2 ? `${broom.name}先碎了，试试在对手冲来时按挡` : '冲空多，等它靠近再冲');
  }
});

test('effective blocks do not suppress explicit defensive orientation advice or winning advice', () => {
  const s = stats('pillow');
  s.perfect = 2;
  assert.equal(tipLine(s, 1), '先碎的是伸出的枕头，试试把它改成贴着');
  assert.equal(tipLine(s, 0), '完美挡了 2 次，换个装法试试别的打法');
});
