import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setNames, matchStats, tipLine, NAMES} from '../../web/src/reason.js';
import {ratingOf, GRADES} from '../../web/src/rating.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url)));
setNames(catalog.items);

function stats(item, orient = 'out', readStats = matchStats, extraEvents = []) {
  return readStats({events: [
    {type: 'dash', phase: 'end', side: 0, quality: 'full'},
    {type: 'break', target: 0, targetPart: 'part-0', item},
    ...extraEvents
  ]}, [{parts: [{item, orient}]}, {parts: []}]);
}

// Synthetic scores belong to a separate module instance, never the shared real-item registry.
let fixtureId = 0;
async function withItems(items, check) {
  const names = {...NAMES}, pillowTip = tipLine(stats('pillow'), 1);
  const reason = await import(`../../web/src/reason.js?tips-fixture=${++fixtureId}`);
  assert.deepEqual(reason.NAMES, {});
  reason.setNames(items);
  check(reason);
  assert.deepEqual(NAMES, names, 'synthetic names must not leak into the normal module');
  assert.equal(tipLine(stats('pillow'), 1), pillowTip, 'synthetic preferences must not change real-item advice');
}

test('every real catalog item whose range is highest keeps its out orientation after breaking', () => {
  const rangeItems = [];
  for (const it of catalog.items) {
    assert.ok(it.rating?.scores, `${it.id} has real scores`);
    const {attack, range, durability} = it.rating.scores;
    if (range < attack || range < durability) continue;
    rangeItems.push(it.id);
    const tip = tipLine(stats(it.id), 1);
    assert.ok(tip.includes('按挡'));
    assert.ok(!tip.includes('改成贴着'), `${it.id} must keep its range`);
  }
  assert.ok(rangeItems.length > 0, 'the full-catalog assertion must exercise real range items');
});

test('a real range item held close suggests moving it out', () => {
  const broom = catalog.items.find(it => it.category === 'broom' && it.rating);
  assert.equal(tipLine(stats(broom.id, 'hug'), 1), `${broom.name}适合伸出，换另一件贴着`);
});

test('a defensive pillow can still move from out to hug', () => {
  assert.equal(tipLine(stats('pillow'), 1), '先碎的是伸出的枕头，试试把它改成贴着');
});

test('same category follows the individual scores, including attack specialists', async () => {
  await withItems([
    {id: 'tip-range', name: '长件', category: 'broom', rating: {scores: {attack: 30, range: 90, durability: 50}}},
    {id: 'tip-guard', name: '厚件', category: 'broom', rating: {scores: {attack: 30, range: 50, durability: 90}}},
    {id: 'tip-attack', name: '硬件', category: 'broom', rating: {scores: {attack: 90, range: 30, durability: 50}}}
  ], ({matchStats: readStats, tipLine: readTip}) => {
    assert.ok(readTip(stats('tip-range', 'out', readStats), 1).includes('按挡'));
    assert.ok(readTip(stats('tip-attack', 'out', readStats), 1).includes('按挡'));
    assert.ok(readTip(stats('tip-guard', 'out', readStats), 1).includes('改成贴着'));
    assert.ok(readTip(stats('tip-attack', 'hug', readStats), 1).includes('适合伸出'));
    assert.ok(!readTip(stats('tip-guard', 'hug', readStats), 1).includes('适合伸出'));
  });
});

test('equal scores and absent scores never invent an orientation preference', async () => {
  await withItems([
    {id: 'tip-equal', name: '均衡件', rating: {scores: {attack: 60, range: 30, durability: 60}}},
    {id: 'tip-unknown', name: '未知件'}
  ], ({matchStats: readStats, tipLine: readTip}) => {
    for (const id of ['tip-equal', 'tip-unknown']) {
      assert.ok(readTip(stats(id, 'out', readStats), 1).includes('按挡'));
      assert.ok(!readTip(stats(id, 'hug', readStats), 1).includes('适合伸出'));
    }
  });
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

test('orientation tolerance includes five points in either direction; six points can prefer attack, range or guard', async () => {
  for (const offense of ['attack', 'range']) {
    for (const gap of [-6, -5, -1, 0, 1, 5, 6]) {
      const id = `tolerance-${offense}-${gap}`;
      const scores = {attack: 20, range: 20, durability: 60};
      scores[offense] = 60 + gap;
      await withItems([{id, name: '测试件', rating: {scores}}], ({matchStats: readStats, tipLine: readTip}) => {
        assert.equal(readTip(stats(id, 'out', readStats), 1).includes('改成贴着'), gap < -5, `${offense} gap ${gap}, out`);
        assert.equal(readTip(stats(id, 'hug', readStats), 1).includes('适合伸出'), gap > 5, `${offense} gap ${gap}, hug`);
      });
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

test('the result card counts 冲中 and 完美挡 as the match showed them (冲挡加重, Elara 61eededb)', () => {
  const s = matchStats({events: [
    // Lunges: only the one that landed full counts; a glance shows nothing in the match.
    {type: 'dash', phase: 'end', side: 0, quality: 'full'},
    {type: 'dash', phase: 'end', side: 0, quality: 'glance'},
    {type: 'dash', phase: 'end', side: 0, quality: 'glance'},
    {type: 'dash', phase: 'end', side: 1, quality: 'full'},
    // Blocks that bounced: a perfect 「弹开！」 counts whether its damage went through or not; an ordinary one never.
    {type: 'blockResult', side: 0, outcome: 'perfect', deflected: true, perfect: true, damageApplied: false},
    {type: 'blockResult', side: 0, outcome: 'perfect', deflected: true, perfect: true, damageApplied: true},
    {type: 'blockResult', side: 0, outcome: 'perfect', deflected: true, perfect: false, damageApplied: true},
    {type: 'blockResult', side: 1, outcome: 'perfect', deflected: true, perfect: true},
    // ?feel=old and older replays: 「完美」 only with its damage through.
    {type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: true},
    {type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: false},
    {type: 'blockResult', side: 0, outcome: 'empty'}
  ]}, [{parts: []}, {parts: []}]);
  assert.equal(s.presses, 3);
  assert.equal(s.landed, 1);
  assert.equal(s.perfect, 3);
  assert.equal(s.blocks, 6);
  // ?feel=old counts as the 评委版 does: a glance is a 冲中 there (Elara 14f39c4f).
  const old = matchStats({events: [
    {type: 'dash', phase: 'end', side: 0, quality: 'full'},
    {type: 'dash', phase: 'end', side: 0, quality: 'glance'},
    {type: 'dash', phase: 'end', side: 0, quality: 'miss'},
    {type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: true},
    {type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: false}
  ]}, [{parts: []}, {parts: []}], undefined, {oldFeel: true});
  assert.equal(old.landed, 2);
  assert.equal(old.missed, 1);
  assert.equal(old.perfect, 1);
});

test('effective blocks do not suppress explicit defensive orientation advice or winning advice', () => {
  const s = stats('pillow');
  s.perfect = 2;
  assert.equal(tipLine(s, 1), '先碎的是伸出的枕头，试试把它改成贴着');
  assert.equal(tipLine(s, 0), '完美挡了 2 次，换个装法试试别的打法');
});

test('the real legacy lamp becomes neutral within five points and teaches blocking instead of hugging', () => {
  const lamp = catalog.items.find(it => it.id === 'lamp');
  assert.deepEqual(lamp.rating.scores, {attack: 52, range: 56, durability: 57});
  assert.equal(tipLine(stats(lamp.id), 1), '台灯先碎了，试试在对手冲来时按挡');
  assert.ok(!tipLine(stats(lamp.id, 'hug'), 1).includes('适合伸出'));
});

test('real neutral pot and lamp with two or more effective blocks fall through for a loss and a draw', () => {
  for (const item of ['pot', 'lamp']) {
    for (const perfect of [2, 3]) {
      const events = Array.from({length: perfect}, () => ({type: 'blockResult', side: 0, outcome: 'perfect', damageApplied: true}));
      const s = stats(item, 'out', matchStats, events);
      assert.equal(s.perfect, perfect);
      assert.equal(s.blocks, perfect);
      assert.equal(tipLine(s, 1), '换个装法再打一局', `${item}, ${perfect} blocks, loss`);
      assert.equal(tipLine(s, null), '时间到按剩血判，多冲中几下就能赢', `${item}, ${perfect} blocks, draw`);
    }
  }
});

test('the two real six-point boundary items retain opposite orientation preferences', () => {
  const pot = catalog.items.find(it => it.id === 'pan-lux3d');
  const lamp = catalog.items.find(it => it.id === 'lamp-lux3d');
  assert.deepEqual(pot.rating.scores, {attack: 89, range: 48, durability: 95});
  assert.deepEqual(lamp.rating.scores, {attack: 46, range: 56, durability: 50});
  assert.equal(tipLine(stats(pot.id), 1), '先碎的是伸出的锅，试试把它改成贴着');
  assert.ok(!tipLine(stats(pot.id, 'hug'), 1).includes('适合伸出'));
  assert.equal(tipLine(stats(lamp.id, 'hug'), 1), '台灯适合伸出，换另一件贴着');
  assert.equal(tipLine(stats(lamp.id), 1), '台灯先碎了，试试在对手冲来时按挡');
});

test('not won against 长臂猿 only encourages, pointing no way (Elara 803193e6)', () => {
  const s = stats('pillow');
  for (let i = 0; i < 4; i++) s.missed++, s.presses++;
  assert.equal(tipLine(s, 1, 'chang'), '长臂猿是最后也是最难的一关，多打几局试试');
  assert.equal(tipLine(s, null, 'chang'), '长臂猿是最后也是最难的一关，多打几局试试');
  assert.equal(tipLine(s, 1, 'mang'), tipLine(s, 1));
  assert.equal(tipLine(s, 0, 'chang'), tipLine(s, 0));
  s.presses = 0;
  assert.equal(tipLine(s, 1, 'chang'), '按冲朝它扑过去，它冲过来时按挡');
});

test('a lost photo lighter or graded below the opponent says to bring a heavier, harder one, or a larger, harder one (Elara 365a2667, f09e8878)', async () => {
  const shot = id => id === 'fanshuo-cup';
  const chang = {parts: [{item: 'fanshuo-feather', orient: 'out'}, {item: 'fanshuo-chair', orient: 'hug'}]};
  const lost = (mine, foe = chang, isShot = shot) => matchStats({events: [{type: 'dash', phase: 'end', side: 0, quality: 'full'}]},
    [{parts: mine.map(item => ({item, orient: 'out'}))}, foe], isShot);
  const s = lost(['fanshuo-cup', 'fanshuo-pot']);
  assert.deepEqual(s.outmatched, {item: 'fanshuo-cup', foe: 'fanshuo-chair', by: 'mass'});
  assert.equal(tipLine(s, 1, 'chang'), '你拍的金属杯比对面的椅子轻，换一件更重、更硬的再来');
  assert.equal(tipLine(s, 1), tipLine(s, 1, 'chang'), 'any stage, not only the last');
  // Not lost, or no photo in the build: the tips stay as they were.
  assert.equal(tipLine(s, 0, 'chang'), tipLine(lost(['fanshuo-cup'], chang, () => false), 0, 'chang'));
  assert.equal(tipLine(s, null, 'chang'), '长臂猿是最后也是最难的一关，多打几局试试');
  assert.equal(lost(['fanshuo-cup', 'fanshuo-pot'], chang, () => false).outmatched, null);
  assert.equal(tipLine(lost(['fanshuo-cup'], chang, () => false), 1, 'chang'), '长臂猿是最后也是最难的一关，多打几局试试');
  // Not pressing anything still hears how to play first.
  s.presses = 0;
  assert.equal(tipLine(s, 1, 'chang'), '按冲朝它扑过去，它冲过来时按挡');
  // Heavier but graded lower names the grades; as heavy and as good says nothing.
  await withItems([
    {id: 'heavy-c', name: '大石头', mass: 2, rating: {scores: {attack: 10, range: 10, durability: 10}}},
    {id: 'heavy-s', name: '铁椅', mass: 2, rating: {scores: {attack: 90, range: 90, durability: 90}}},
    {id: 'light-s', name: '刀', mass: .3, rating: {scores: {attack: 90, range: 90, durability: 90}}},
    {id: 'shot-1', name: '我拍的拖鞋', mass: .16, rating: {scores: {attack: 5, range: 10, durability: 40}}}
  ], ({matchStats: readStats, tipLine: readTip}) => {
    const read = (mine, foe) => readStats({events: [{type: 'dash', phase: 'end', side: 0, quality: 'full'}]},
      [{parts: [{item: mine, orient: 'out'}]}, {parts: foe.map(item => ({item, orient: 'out'}))}], () => true);
    assert.equal(readTip(read('heavy-c', ['heavy-s']), 1), '你拍的大石头是 D 级，对面的铁椅是 S 级，换一件等级更高的再来');
    assert.equal(readTip(read('heavy-c', ['light-s']), 1), '你拍的大石头是 D 级，对面的刀是 S 级，换一件等级更高的再来');
    assert.equal(read('heavy-s', ['heavy-s', 'light-s']).outmatched, null);
    assert.equal(read('light-s', ['heavy-c']).outmatched.by, 'mass');
    assert.equal(readTip(read('shot-1', ['heavy-s']), 1), '你拍的拖鞋比对面的铁椅轻，换一件更重、更硬的再来');
  });
});

test('loss advice compares current catalog grades after photo ratings change', () => {
  const loss = (photo, foe) => {
    const replay = {events: [{type: 'dash', phase: 'end', side: 0, quality: 'full'}]};
    return matchStats(replay, [{parts: [{item: photo, orient: 'out'}]}, {parts: [{item: foe, orient: 'out'}]}],
      id => id === photo);
  };

  // A heavier photo graded below the opponent's best names both grades, whatever the current rule makes them (Sol 3b5986f1).
  const mouse = loss('fanshuo-mouse', 'fanshuo-cup'), grade = id => ratingOf(catalog.items.find(i => i.id === id)).grade;
  assert.ok(GRADES.indexOf(grade('fanshuo-mouse')) > GRADES.indexOf(grade('fanshuo-cup')));
  assert.deepEqual(mouse.outmatched, {item: 'fanshuo-mouse', foe: 'fanshuo-cup', by: 'grade'});
  assert.equal(tipLine(mouse, 1), `你拍的鼠标是 ${grade('fanshuo-mouse')} 级，对面的金属杯是 ${grade('fanshuo-cup')} 级，换一件等级更高的再来`);
});

test('lost stage 1 on time without a 冲 says so; anyone who lunged, other stages and ?feel=old do not (Elara 27b4d4c3)', () => {
  const turtle = '时间到：你一直在挡，没出手。挡住后点冲，才打得掉它的血';
  const read = (reason, presses, blocks, oldFeel = false) => matchStats({meta: {reason}, events: [
    ...Array.from({length: presses}, () => ({type: 'dash', phase: 'end', side: 0, quality: 'blocked'})),
    ...Array.from({length: blocks}, () => ({type: 'blockResult', side: 0, outcome: 'tight', deflected: true}))
  ]}, [{parts: []}, {parts: []}], () => false, {oldFeel});
  assert.equal(tipLine(read('timeout', 0, 12), 1, 'mang'), turtle);
  assert.equal(tipLine(read('timeout', 0, 1), 1, 'mang'), turtle);
  assert.equal(tipLine(read('timeout', 1, 12), 1, 'mang'), '时间到：出手太少。挡住后点冲，才打得掉它的血', 'one 冲 is not 没出手, but still too few');
  assert.notEqual(tipLine(read('timeout', 0, 12), 1, 'wen'), turtle, 'stage 1 only');
  assert.notEqual(tipLine(read('timeout', 0, 12), 1), turtle, 'not off the ladder');
  assert.notEqual(tipLine(read('timeout', 0, 12, true), 1, 'mang'), turtle, 'not ?feel=old');
  assert.notEqual(tipLine(read('ko', 0, 12), 1, 'mang'), turtle, 'only a loss on time');
  assert.notEqual(tipLine(read('timeout', 0, 12), null, 'mang'), turtle, 'not a draw');
});
