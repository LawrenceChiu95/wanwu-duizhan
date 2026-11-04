import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
import {reasonLine, setNames} from '../../web/src/reason.js';

const cases = JSON.parse(readFileSync(new URL('./v18-cases.json', import.meta.url)));
setNames(JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url))).items);
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const expected = {
  2891: '对手的核心撞碎了你的核心\n对手的核心还剩47%血',
  9099: '你的核心撞碎了对手的核心\n你的核心还剩55%血'
};

for (const fixture of cases) {
  test(`v18 seed ${fixture.options.seed}: fewer attachments can win; terminal fact changes no physics`, async () => {
    const r = await simulateV3(fixture.options), {physics} = fixture.expected;
    assert.equal(r.meta.winner, fixture.expected.winner);
    assert.equal(r.meta.duration, fixture.expected.duration);
    assert.equal(sha(r.meta), physics.meta, 'all metadata and inputs remain identical');
    assert.equal(sha(r.frames), physics.frames, 'every physical frame remains identical');
    assert.equal(sha(r.events.slice(0, -1)), physics.eventsBeforeResult, 'all non-result events remain identical');
    const final = r.frames.at(-1).fighters, why = r.decisive.why;
    assert.deepEqual(why.coreRatios, final.map(f => f.core.hp / f.core.maxHp));
    assert.deepEqual(why.partsLeft, final.map(f => f.parts.filter(p => p.alive).length));
    assert.equal(why.attackerPart, 'core');
    assert.equal(why.targetPart, 'core');
    assert.equal(why.role, r.events[r.decisive.eventIndex].role);
    assert.ok(why.partsLeft[r.meta.winner] < why.partsLeft[1-r.meta.winner]);
    assert.deepEqual(r.events.at(-1).why, why);
    assert.equal(reasonLine(r), expected[fixture.options.seed]);
    assert.equal(reasonLine(fixture.legacy), expected[fixture.options.seed], 'stored v18 replay remains readable');
    assert.ok(!reasonLine(r).includes('没了攻击'));
    assert.ok(!reasonLine(r).includes('没了遮挡'));
  });
}

function ko(why) {
  return {meta: {reason: 'ko', winner: 1}, decisive: {why: {attacker: 1, target: 0, attackerItem: null, role: 'attack', ...why}}};
}

test('actual lethal attachment or recoil takes priority over a previously broken attachment', () => {
  const broken = {loserBroken: [{item: 'pillow', orient: 'hug'}], loserPartsLeft: 1};
  assert.equal(reasonLine(ko({...broken, attackerItem: 'pan-lux3d'})), '对手的锅撞碎了你的核心');
  assert.equal(reasonLine(ko({...broken, attackerItem: 'pan-lux3d', role: 'recoil'})), '你的核心撞上对手的锅，你的核心先碎了');
  assert.equal(reasonLine(ko({...broken, role: 'recoil'})), '你的核心撞上对手的核心，你的核心先碎了');
  assert.equal(reasonLine(ko({attacker: 0, target: 1, attackerItem: 'broom', role: 'recoil'})), '对手的核心撞上你的扫把，对手的核心先碎了');
});

test('damaged winner never displays full HP; exact full HP and lower rounding remain accurate', () => {
  for (const [ratio, shown] of [[.9949, '99'], [.995, '99'], [.999999, '99'], [1, '100'], [.985, '99'], [.9849, '98']]) {
    assert.equal(reasonLine(ko({partsLeft: [1, 0], coreRatios: [0, ratio]})), `对手的核心撞碎了你的核心\n对手的核心还剩${shown}%血`);
  }
  const mine = ko({attacker: 0, target: 1, partsLeft: [0, 1], coreRatios: [.999, 0]});
  mine.meta.winner = 0;
  assert.equal(reasonLine(mine), '你的核心撞碎了对手的核心\n你的核心还剩99%血');
});

test('legacy recoil reads the lethal event at a nonzero index and the stored terminal frame', () => {
  const replay = ko({attackerItem: 'pan-lux3d'});
  delete replay.decisive.why.role;
  replay.decisive.eventIndex = 2;
  replay.events = [{role: 'attack'}, {role: 'attack'}, {role: 'recoil'}, {type: 'result', role: 'attack'}];
  replay.frames = [{fighters: [
    {core: {hp: 0, maxHp: 100}, parts: [{alive: true}, {alive: false}]},
    {core: {hp: 99.9, maxHp: 100}, parts: [{alive: false}, {alive: false}]}
  ]}];
  assert.equal(reasonLine(replay), '你的核心撞上对手的锅，你的核心先碎了\n对手的核心还剩99%血');
  replay.decisive.why.role = 'attack';
  assert.equal(reasonLine(replay), '对手的锅撞碎了你的核心\n对手的核心还剩99%血', 'an explicit new role takes precedence over the legacy event');
});

test('legacy active lethal collision is not mislabeled by an earlier recoil event', () => {
  const replay = ko({attackerItem: 'pan-lux3d'});
  delete replay.decisive.why.role;
  replay.decisive.eventIndex = 2;
  replay.events = [{role: 'recoil'}, {role: 'recoil'}, {role: 'attack'}, {type: 'result'}];
  assert.equal(reasonLine(replay), '对手的锅撞碎了你的核心');
});

test('unknown lethal item names use a generic object name for either side and recoil', () => {
  const unknown = 'not-in-this-catalog';
  assert.equal(reasonLine(ko({attackerItem: unknown})), '对手的道具撞碎了你的核心');
  assert.equal(reasonLine(ko({attackerItem: unknown, role: 'recoil'})), '你的核心撞上对手的道具，你的核心先碎了');
  assert.equal(reasonLine(ko({attacker: 0, target: 1, attackerItem: unknown})), '你的道具撞碎了对手的核心');
  assert.equal(reasonLine(ko({attacker: 0, target: 1, attackerItem: unknown, role: 'recoil'})), '对手的核心撞上你的道具，对手的核心先碎了');
});

test('ordinary KO does not invent a remaining-HP comparison; tiny positive HP is not displayed as zero', () => {
  assert.equal(reasonLine(ko({partsLeft: [0, 1], coreRatios: [0, .2]})), '对手的核心撞碎了你的核心');
  assert.equal(reasonLine(ko({partsLeft: [1, 0], coreRatios: [0, .001]})), '对手的核心撞碎了你的核心\n对手的核心还剩不足1%血');
});

test('timeout and simultaneous KO retain their distinct terminal facts', () => {
  assert.equal(reasonLine({meta: {reason: 'timeout', winner: 0}, decisive: {why: {kind: 'timeout', criterion: 'core-hp-ratio'}}}), '时间到，你的核心剩血多');
  assert.equal(reasonLine({meta: {reason: 'timeout', winner: 1}, decisive: {why: {kind: 'timeout', criterion: 'part-hp'}}}), '时间到，核心一样，对手的件剩血多');
  assert.equal(reasonLine({meta: {reason: 'timeout', winner: null}, decisive: {why: {kind: 'timeout', criterion: 'draw'}}}), '时间到，两边剩的血一样多');
  assert.equal(reasonLine({meta: {reason: 'double-ko', winner: null}, decisive: {why: null}}), '两边核心同时碎了');
  assert.equal(reasonLine({meta: {reason: 'double-ko', winner: 1}, decisive: {why: {attacker: 1, target: 0}}}), '两颗核心同时碎，你伤得更重');
});
