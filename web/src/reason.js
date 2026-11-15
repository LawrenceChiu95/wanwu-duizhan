import {ratingOf} from './rating.js';
// State the actual terminal damage; broken attachments never replace the cause of a core KO.
// Short names from the catalog (the Lux3D tag is shown on its own); filled by setNames before the page draws anything.
export const NAMES = {};
const PREFERRED_ORIENT = {};
const MASS = {}, GRADE = {};
const GRADE_RANK = {S: 0, A: 1, B: 2, C: 3, D: 4};
export function setNames(items) {
  for (const it of items) {
    if (typeof it.name !== 'string' || !it.name.trim()) throw Error(`物品 ${it.id} 在 catalog 里没有名字`);
    NAMES[it.id] = it.name.trim().replace(/（Lux3D）$/, '');
    const scores = ratingOf(it)?.scores;
    const offense = scores && Math.max(scores.attack, scores.range);
    PREFERRED_ORIENT[it.id] = !scores || Math.abs(scores.durability - offense) <= 5 ? null : scores.durability > offense ? 'hug' : 'out';
    MASS[it.id] = Number.isFinite(it.mass) ? it.mass : null;
    GRADE[it.id] = ratingOf(it)?.grade ?? null;
  }
}

/** Whole seconds shown for a match time: the fight clock and the result card use this one rounding. */
export const wholeSeconds = t => Math.floor(t + 1e-6);

export function reasonLine(replay) {
  const {reason} = replay.meta, why = replay.decisive.why;
  if (reason === 'double-ko' && replay.meta.winner === null) return '两边核心同时碎了';
  if (reason === 'timeout') {
    // 时间到 is judged too (Sol 1da0b823): core HP left first, then the pieces still standing; equal on both is a draw.
    const W = replay.meta.winner === 0 ? '你' : '对手';
    if (why?.kind !== 'timeout' || replay.meta.winner === null) return why?.kind === 'timeout' ? '时间到，两边剩的血一样多' : '时间到，两颗核心都还在';
    return why.criterion === 'part-hp' ? `时间到，核心一样，${W}的件剩血多` : `时间到，${W}的核心剩血多`;
  }
  if (!why) return '核心先被打空的一方输了';
  const W = why.attacker === 0 ? '你' : '对手', L = why.target === 0 ? '你' : '对手';
  // Both broke in the same instant; the decided loser is the one hit harder past zero.
  if (reason === 'double-ko') return `两颗核心同时碎，${L}伤得更重`;
  const att = why.attackerItem ? NAMES[why.attackerItem] ?? '道具' : '核心';
  // Stored v18 replays lack the new why fields; their terminal frame/event contain the same facts.
  const final = replay.frames?.at(-1)?.fighters;
  const role = why.role ?? replay.events?.[replay.decisive.eventIndex]?.role;
  const partsLeft = why.partsLeft ?? final?.map(f => f.parts.filter(p => p.alive).length);
  const ratios = why.coreRatios ?? final?.map(f => f.core.hp / f.core.maxHp);
  const main = role === 'recoil' ? `${L}的核心撞上${W}的${att}，${L}的核心先碎了` : `${W}的${att}撞碎了${L}的核心`;
  const winner = replay.meta.winner;
  if (partsLeft && ratios && (winner === 0 || winner === 1) && partsLeft[winner] < partsLeft[1 - winner]) {
    const name = winner === 0 ? '你' : '对手', ratio = ratios[winner];
    return `${main}\n${name}的核心还剩${ratio < .01 ? '不足1' : Math.min(ratio < 1 ? 99 : 100, Math.round(ratio * 100))}%血`;
  }
  return main;
}

/** The result card's top line: how the match ended. */
export function endLine(replay) {
  const {reason} = replay.meta;
  return reason === 'timeout' ? '时间到，比剩血' : reason === 'double-ko' ? '两颗核心同时碎了' : '核心碎了';
}

/** What the player did this match, from the replay's own events (the page never judges a hit itself). */
/** `shot(id)`: whether the player photographed this item (拍一件), for `outmatched`. `oldFeel`: ?feel=old, counted exactly as
 * the 评委版 counts (a glance is a 冲中 there, Elara 14f39c4f). */
export function matchStats(replay, defs, shot = () => false, {oldFeel = false} = {}) {
  const s = {presses: 0, landed: 0, blocked: 0, missed: 0, perfect: 0, blocks: 0, firstBroken: [null, null], timeout: replay.meta?.reason === 'timeout', oldFeel,
    // Advice follows this item's scores, rather than its category or overall grade.
    hugAttacker: defs[0]?.parts.find(p => p.orient === 'hug' && PREFERRED_ORIENT[p.item] === 'out' && !defs[0].parts.some(other => other !== p && PREFERRED_ORIENT[other.item] === 'out'))?.item ?? null,
    outmatched: outmatched(defs[0]?.parts.map(p => p.item).filter(shot) ?? [], defs[1]?.parts.map(p => p.item) ?? [])};
  const tiered = Boolean(replay.meta?.combatRules?.guardTiming);
  for (const e of replay.events) {
    if (e.type === 'dash' && e.phase === 'end' && e.side === 0) {
      s.presses++;
      const q = e.quality ?? (e.outcome === 'hit' ? 'full' : e.outcome);
      // 冲中 counts the lunges the match showed as landed; a glance shows none of that, so it is not one (Elara 61eededb).
      if (q === 'full' || oldFeel && q === 'glance') s.landed++;
      else if (q === 'blocked') s.blocked++;
      else if (q === 'miss') s.missed++;
    } else if (e.type === 'blockResult' && e.side === 0) {
      s.blocks++;
      // 完美挡 counts what the match showed as one: since 冲挡加重 a perfect 「弹开！」 (a lunge caught head-on, damage or not);
      // a block that did not bounce anything (older replays, ?feel=old), 「完美」, shown only when its damage went through.
      // 挡分两档 (guardTiming): every 完美 the match said 「完美！」 for; 勉强 is a block, not a perfect one.
      if (e.deflected ? e.perfect || tiered : e.outcome === 'perfect' && e.damageApplied !== false) s.perfect++;
    } else if (e.type === 'break' && !s.firstBroken[e.target]) {
      const k = Number(String(e.targetPart).split('-')[1]);
      s.firstBroken[e.target] = {item: e.item, orient: defs[e.target]?.parts[k]?.orient ?? null};
    }
  }
  return s;
}

// A photographed item lighter than the opponent's heaviest part, or graded below its best one (Elara 365a2667): what
// the photo was up against, so the tip can name both. Unknown mass or grade compares as nothing.
function outmatched(mine, foe) {
  const heavy = foe.filter(id => MASS[id] != null).sort((a, b) => MASS[b] - MASS[a])[0];
  const best = foe.filter(id => GRADE[id]).sort((a, b) => GRADE_RANK[GRADE[a]] - GRADE_RANK[GRADE[b]])[0];
  for (const id of mine) {
    if (heavy && MASS[id] != null && MASS[id] < MASS[heavy]) return {item: id, foe: heavy, by: 'mass'};
    if (best && GRADE[id] && GRADE_RANK[GRADE[id]] > GRADE_RANK[GRADE[best]]) return {item: id, foe: best, by: 'grade'};
  }
  return null;
}

/** At most three numbers, the ones that most explain this result. */
export function pickStats(s, winner) {
  const out = [], broke = s.firstBroken[winner === 0 ? 1 : 0];
  if (broke && winner !== null) out.push({value: NAMES[broke.item] ?? '', label: winner === 0 ? '对手先碎的' : '你先碎的'});
  out.push({value: String(s.landed), label: '冲中'});
  const blocked = {value: String(s.blocked), label: '被挡', n: s.blocked}, missed = {value: String(s.missed), label: '冲空', n: s.missed};
  const perfect = {value: String(s.perfect), label: '完美挡', n: s.perfect};
  // Winning: how it was won. Losing: the bigger of 被挡 / 冲空 first, it is the likelier reason.
  const rest = winner === 0 ? [perfect, blocked] : [...[blocked, missed].sort((x, y) => y.n - x.n), perfect];
  for (const x of rest) if (out.length < 3 && (x.n > 0 || out.length < 2)) out.push({value: x.value, label: x.label});
  return out.slice(0, 3);
}

// Not won against a ladder opponent whose stage only asks for more tries: the tip encourages without pointing a way, since
// no build is shown to beat it (Elara 803193e6; Sol 2b411bc5: 长臂猿 is only harder than 老龟).
const FOE_TIP = {chang: '长臂猿是最后也是最难的一关，多打几局试试'};
// Lost to a ladder opponent whose build makes it read tougher than its hp: say why and how to get through, ahead of any
// other tip (凡朔's 对象 took 老龟 for having more hp: both its pieces hug and it blocks a lot; Elara b9d6e779, 2621157e).
const FOE_WHY = {wen: '老龟两件都贴着、又爱挡，别迎头冲，等它挡完再冲'};

/** One tip, by fixed rules, for the next match. `foe`: the ladder opponent's id, when it was one. */
export function tipLine(s, winner, foe = null) {
  const mine = s.firstBroken[0];
  if (winner === 0) return s.perfect ? `完美挡了 ${s.perfect} 次，换个装法试试别的打法` : '赢了。试试换个装法，看能不能赢得更快';
  if (s.presses === 0 && s.blocks === 0) return '按冲朝它扑过去，它冲过来时按挡';
  // Lost stage 1 on time without a single 冲 (Sol a8851e63: its turtle runs out the clock 99 times in 100): say so plainly.
  // Only there, new feel, never pressed: telling a player who did lunge 「没出手」 is worse than saying nothing (Elara 27b4d4c3).
  // Anyone else losing stage 1 on time hears they lunged too little, never the 莽牛 line on blocking (Castor 72baf2c8, Elara ad7297c3).
  if (winner === 1 && foe === 'mang' && s.timeout && !s.oldFeel) return s.presses === 0 ? '时间到：你一直在挡，没出手。挡住后点冲，才打得掉它的血' : '时间到：出手太少。挡住后点冲，才打得掉它的血';
  if (winner === 1 && FOE_WHY[foe]) return FOE_WHY[foe];
  // Ahead of the 长臂猿 encouragement: a photo too light to win should hear so at any stage (Elara 365a2667).
  const o = winner === 1 && s.outmatched;
  if (o) {
    // An item still named for what it was taken as (「我拍的拖鞋」) loses the 我拍的: the line says 你拍的 already.
    const mine = (NAMES[o.item] ?? '那件').replace(/^我拍的/, ''), foe = NAMES[o.foe] ?? '那件';
    return o.by === 'mass' ? `你拍的${mine}比对面的${foe}轻，换一件更重、更硬的再来`
      // A grade can come from attack as much as durability, so a lower one says nothing about which is harder (Elara 07c3c82a).
      : `你拍的${mine}是 ${GRADE[o.item]} 级，对面的${foe}是 ${GRADE[o.foe]} 级，换一件等级更高的再来`;
  }
  if (FOE_TIP[foe]) return FOE_TIP[foe];
  if (winner === 1 && s.hugAttacker) return `${NAMES[s.hugAttacker] ?? '这件'}适合伸出，换另一件贴着`;
  if (mine?.orient === 'out') {
    if (PREFERRED_ORIENT[mine.item] === 'hug') return `先碎的是伸出的${NAMES[mine.item] ?? '那件'}，试试把它改成贴着`;
    if (s.perfect < 2) return `${NAMES[mine.item] ?? '伸出的件'}先碎了，试试在对手冲来时按挡`;
  }
  if (s.missed >= 3 && s.missed >= s.presses / 2) return '冲空多，等它靠近再冲';
  if (s.blocked >= 2) return '冲进了它的挡，等它挡完再冲';
  if (s.landed === 0) return '一次没冲中，离近一点再按冲';
  if (s.blocks === 0) return '它冲过来时按挡，能把它弹开';
  if (mine?.orient === 'hug') return `贴着的${NAMES[mine.item] ?? '那件'}被打碎了，换一件更结实的贴着`;
  return winner === null ? '时间到按剩血判，多冲中几下就能赢' : '换个装法再打一局';
}
