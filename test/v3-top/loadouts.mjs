// 陀螺版：网页提供的 6 件、网页的固定对手、所有合法装法（批量脚本共用）。
export const OFFER = ['pan-lux3d', 'broom', 'lamp-lux3d', 'scissors', 'slipper', 'pillow'];
export const FOE = {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'lamp-lux3d', mount: 'e180', orient: 'hug'}]};
export const LOADOUTS = [];
for (let i = 0; i < OFFER.length; i++) for (let j = 0; j < OFFER.length; j++) if (i !== j) for (const a of ['out', 'hug']) for (const b of ['out', 'hug']) for (const spread of ['e180', 'e90'])
  LOADOUTS.push({parts: [{item: OFFER[i], mount: 'e0', orient: a}, {item: OFFER[j], mount: spread, orient: b}]});
