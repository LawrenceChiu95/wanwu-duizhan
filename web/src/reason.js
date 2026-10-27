// One plain line (≤20 characters) for why the match ended, from the replay's decisive.why facts.
export const NAMES = {'pan-lux3d': '锅', 'lamp-lux3d': '台灯', broom: '扫把', scissors: '剪刀', slipper: '拖鞋', pillow: '枕头', pot: '锅', lamp: '台灯'};

export function reasonLine(replay) {
  const {reason} = replay.meta, why = replay.decisive.why;
  if (reason === 'timeout' || !why) return '时间到，两颗核心都还在';
  if (reason === 'double-ko') return '同一下撞碎了两颗核心';
  const W = why.attacker === 0 ? '你' : '对手', L = why.target === 0 ? '你' : '对手';
  const att = why.attackerItem ? NAMES[why.attackerItem] : null;
  const broken = why.loserBroken.map(b => NAMES[b.item]);
  if (why.loserPartsLeft === 0 && broken.length) return `${L}两件都碎了，核心被${att ?? (W === '你' ? '你' : '对手')}撞碎`;
  if (broken.length) return `${L}的${broken[0]}先碎了，核心没了遮挡`;
  if (!att) return `两颗核心硬碰，${W}撞赢了`;
  if (why.attackerOrient === 'out') return `${W}的${att}伸得远，直接打中核心`;
  return `${W}贴着的${att}撞中了核心`;
}
