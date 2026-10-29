// One plain line (≤20 characters) for why the match ended, from the replay's decisive.why facts.
// Short names from the catalog (the Lux3D tag is shown on its own); filled by setNames before the page draws anything.
export const NAMES = {};
export function setNames(items) {
  for (const it of items) {
    if (typeof it.name !== 'string' || !it.name.trim()) throw Error(`物品 ${it.id} 在 catalog 里没有名字`);
    NAMES[it.id] = it.name.trim().replace(/（Lux3D）$/, '');
  }
}

export function reasonLine(replay) {
  const {reason} = replay.meta, why = replay.decisive.why;
  if (reason === 'double-ko' && replay.meta.winner === null) return '两边核心同时碎了';
  if (reason === 'timeout' || !why) return '时间到，两颗核心都还在';
  const W = why.attacker === 0 ? '你' : '对手', L = why.target === 0 ? '你' : '对手';
  // Both broke in the same instant; the decided loser is the one hit harder past zero.
  if (reason === 'double-ko') return `两颗核心同时碎，${L}伤得更重`;
  const att = why.attackerItem ? NAMES[why.attackerItem] : null;
  const broken = why.loserBroken.map(b => NAMES[b.item]);
  if (why.loserPartsLeft === 0 && broken.length) return `${L}两件都碎了，核心被${att ?? (W === '你' ? '你' : '对手')}撞碎`;
  if (broken.length) return `${L}的${broken[0]}先碎了，核心没了遮挡`;
  if (!att) return `两颗核心硬碰，${W}撞赢了`;
  if (why.attackerOrient === 'out') return `${W}的${att}伸得远，直接打中核心`;
  return `${W}贴着的${att}撞中了核心`;
}
