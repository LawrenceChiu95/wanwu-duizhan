// One plain line (≤20 characters) for why the match ended, from the replay's decisive.why facts.
// Short names from the catalog (the Lux3D tag is shown on its own); filled by setNames before the page draws anything.
export const NAMES = {};
const PREFERRED_ORIENT = {};
export function setNames(items) {
  for (const it of items) {
    if (typeof it.name !== 'string' || !it.name.trim()) throw Error(`物品 ${it.id} 在 catalog 里没有名字`);
    NAMES[it.id] = it.name.trim().replace(/（Lux3D）$/, '');
    const scores = it.rating?.scores;
    const offense = scores && Math.max(scores.attack, scores.range);
    PREFERRED_ORIENT[it.id] = !scores || scores.durability === offense ? null : scores.durability > offense ? 'hug' : 'out';
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
  if (!why) return '时间到，两颗核心都还在';
  const W = why.attacker === 0 ? '你' : '对手', L = why.target === 0 ? '你' : '对手';
  // Both broke in the same instant; the decided loser is the one hit harder past zero.
  if (reason === 'double-ko') return `两颗核心同时碎，${L}伤得更重`;
  const att = why.attackerItem ? NAMES[why.attackerItem] : null;
  const broken = why.loserBroken.map(b => NAMES[b.item]);
  if (why.loserPartsLeft === 0 && broken.length) return `${L}两件都碎了，核心被${att ?? (W === '你' ? '你' : '对手')}撞碎`;
  // A piece held out was there to hit (losing it costs the attack); only a hugging piece was shielding the core.
  if (broken.length) return why.loserBroken[0].orient === 'out' ? `${L}伸出去的${broken[0]}先碎了，没了攻击` : `${L}贴着的${broken[0]}先碎了，核心没了遮挡`;
  if (!att) return `两颗核心硬碰，${W}撞赢了`;
  if (why.attackerOrient === 'out') return `${W}的${att}伸得远，直接打中核心`;
  return `${W}贴着的${att}撞中了核心`;
}

/** The result card's top line: how the match ended. */
export function endLine(replay) {
  const {reason} = replay.meta;
  return reason === 'timeout' ? '时间到，比剩血' : reason === 'double-ko' ? '两颗核心同时碎了' : '核心碎了';
}

/** What the player did this match, from the replay's own events (the page never judges a hit itself). */
export function matchStats(replay, defs) {
  const s = {presses: 0, landed: 0, blocked: 0, missed: 0, perfect: 0, blocks: 0, firstBroken: [null, null],
    // Advice follows this item's scores, rather than its category or overall grade.
    hugAttacker: defs[0]?.parts.find(p => p.orient === 'hug' && PREFERRED_ORIENT[p.item] === 'out' && !defs[0].parts.some(other => other !== p && PREFERRED_ORIENT[other.item] === 'out'))?.item ?? null};
  for (const e of replay.events) {
    if (e.type === 'dash' && e.phase === 'end' && e.side === 0) {
      s.presses++;
      const q = e.quality ?? (e.outcome === 'hit' ? 'full' : e.outcome);
      if (q === 'full' || q === 'glance') s.landed++;
      else if (q === 'blocked') s.blocked++;
      else if (q === 'miss') s.missed++;
    } else if (e.type === 'blockResult' && e.side === 0) {
      s.blocks++;
      if (e.outcome === 'perfect' && e.damageApplied !== false) s.perfect++;
    } else if (e.type === 'break' && !s.firstBroken[e.target]) {
      const k = Number(String(e.targetPart).split('-')[1]);
      s.firstBroken[e.target] = {item: e.item, orient: defs[e.target]?.parts[k]?.orient ?? null};
    }
  }
  return s;
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

/** One tip, by fixed rules, for the next match. */
export function tipLine(s, winner) {
  const mine = s.firstBroken[0];
  if (winner === 0) return s.perfect ? `完美挡了 ${s.perfect} 次，换个装法试试别的打法` : '赢了。试试换个装法，看能不能赢得更快';
  if (s.presses === 0 && s.blocks === 0) return '按冲朝它扑过去，它冲过来时按挡';
  if (winner === 1 && s.hugAttacker) return `${NAMES[s.hugAttacker] ?? '这件'}适合伸出，换另一件贴着`;
  if (mine?.orient === 'out') return PREFERRED_ORIENT[mine.item] === 'hug'
    ? `先碎的是伸出的${NAMES[mine.item] ?? '那件'}，试试把它改成贴着`
    : `${NAMES[mine.item] ?? '伸出的件'}先碎了，试试在对手冲来时按挡`;
  if (s.missed >= 3 && s.missed >= s.presses / 2) return '冲空多，等它靠近再冲';
  if (s.blocked >= 2) return '冲进了它的挡，等它挡完再冲';
  if (s.landed === 0) return '一次没冲中，离近一点再按冲';
  if (s.blocks === 0) return '它冲过来时按挡，能把它弹开';
  if (mine?.orient === 'hug') return `贴着的${NAMES[mine.item] ?? '那件'}被打碎了，换一件更结实的贴着`;
  return winner === null ? '时间到按剩血判，多冲中几下就能赢' : '换个装法再打一局';
}
