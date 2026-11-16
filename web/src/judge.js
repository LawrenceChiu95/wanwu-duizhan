/**
 * 评委版 (task #4, Elara 51c72819): `npm run build:judge` builds this page with __JUDGE__ on. A judge opens a link on a
 * phone and plays with the nine default items, and 拍一件 shoots through the backend at the same origin (Elara edd90212);
 * when it can't now, the nine still play. Beside 拍照 are two real generations to replay and to play with (Elara
 * 9e17f724, 9c352da4): first the thermos 远夏 shot on 11-10 (job j_ad9f97af), then the flip-flop made from a public photo
 * (Sol's task 26 run, job j_a3187a76). With ?shoot=off nothing calls a backend and 拍一件 is only those two.
 * Loaded only when __JUDGE__ is on, so their pictures and models stay out of the normal build.
 */
import thermosJson from '../../data/showcase/thermos/item.json';
import thermosGlb from '../../data/showcase/thermos/model.glb?url';
import thermosPhoto from '../../data/showcase/thermos/photo.webp?url';
import thermosStyled from '../../data/showcase/thermos/styled.webp?url';
import flipflopJson from '../../data/showcase/flipflop/item.json';
import flipflopGlb from '../../data/showcase/flipflop/model.glb?url';
import flipflopPhoto from '../../data/showcase/flipflop/photo.webp?url';
import flipflopStyled from '../../data/showcase/flipflop/styled.webp?url';

// The item as the page uses it: the backend's record with its files swapped for the bundled URLs. Steps are the
// generation's own times: the thermos's as the backend logged them; the flip-flop's without the 155 s the run stood
// still while the credits were checked by hand (Sol 378c66c6).
const bundle = (json, glb, photo, styled, extra = {}) => ({...json, ...extra, glb, origin: {...json.origin, photo, styled}});
// The flip-flop's 3D swings about the upright instead of turning (livecards.js): the model stands on its sole's edge, so it
// starts three-quarter like the opening card's picture, straps showing, and never turns its sole to the camera (Elara 907b6fa5).
// tag says whose photo it is, beside the replay; credit is the line under it (Elara 9c352da4).
export const showcases = [
  {item: bundle(thermosJson, thermosGlb, thermosPhoto, thermosStyled), tag: '我们真拍', own: true,
    credit: '我们用手机真拍的照片，已裁切；认物、改图和建模都是真跑的'},
  {item: bundle(flipflopJson, flipflopGlb, flipflopPhoto, flipflopStyled, {card: {swing: 0.7}}), tag: '照片来自网上公开图片', own: false,
    credit: '原照 Michal Osmenda · CC BY-SA 2.0，已裁切；改图和建模是真跑的'}
];

// 素材署名 in this build (Elara 907b6fa5): Chinese, only what the judges get, one line per thing. The twelve characters
// (the 角色库 and all three opponents) come from the team's package 保留原色改装版 2026-11-05 R1: per item a photo, its
// wasteland restyle and a GLB its notes say Aholo G1-Turbo (Lux3D's generator) made (开发归档/凡朔模型包/RESULT.md); no
// name, 远夏 71a7f90f (Elara b7d81a8b). The models after them no longer play but still ship in this build, so their credits stay.
// The five Lux3D ones list the photo each was made from: 锅 and 废土锅 share docoverachiever's cast-iron pan (Wren's
// imgs/meta.json pan-2.jpg; checked against the Flickr page — data/lux3d/RECEIPT.md named kevin dooley's「Frying pan」,
// which is pan-0); 废土扫把's photo is 1024greenstreet's (Wren 520f0486, 开发归档/素材署名-原照溯源).
const CC = {'by-2': '[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)', 'by-3': '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)',
  'by-4': '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)', 'by-sa-2': '[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)'};
export const creditsMd = `
## 角色
角色库和三个对手用的 12 件，都是本队用实拍原照改图、再由 Lux3D 生成：刀、锅、抱枕、鼠标、盘子、剃须刀、椅子、按摩滚筒、摄像头、羽毛杆、兔子靠垫、金属杯。

## 早期版本的模型（随页面附带，对战中不出现）
| 模型 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 锅（照片 → Lux3D 生成） | 原照 docoverachiever | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/90692748@N04/47347731882) |
| 台灯（照片 → Lux3D 生成） | 原照 Artdecodude | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/62920259@N03/5771792573) |
| 废土刀（照片 → Lux3D 生成） | 本队 | 本队自制 | |
| 废土锅（照片 → Lux3D 生成） | 原照 docoverachiever | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/90692748@N04/47347731882) |
| 废土扫把（照片 → Lux3D 生成，原照的柄出画，改图时补全） | 原照 1024greenstreet | ${CC['by-sa-2']} | [Flickr](https://www.flickr.com/photos/82432653@N00/858454965) |
| 扫把 | Poly by Google | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/bzCi_ZLQPN4) |
| 剪刀 | Zsky | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/RRyFBBtM2K) |
| 拖鞋 | inciprocal | ${CC['by-4']} | [Sketchfab](https://sketchfab.com/3d-models/worn-flip-flop-000074a334c541878360457c672b6c2e) |
| 拖鞋的碰撞外形 | J-Toastie | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/2wR1M99UwP) |
| 枕头 | Poly by Google | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/f60emm1Xkas) |

标「Lux3D 生成」的都由 Aholo Lux3D 从照片生成，按 Aholo 黑客松条款使用。模型都统一了尺寸和朝向。

## 拍一件示例
| 素材 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 保温杯原照（已裁切、改图并建模） | 本队 | 本队自拍 | |
| 人字拖原照（已裁切、改图并建模） | Michal Osmenda | ${CC['by-sa-2']} | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Flip-flops_%283409558121%29.jpg) |

## 字体和程序
| 名字 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 得意黑（字体） | atelierAnchor | [SIL OFL 1.1](https://scripts.sil.org/OFL) | [GitHub](https://github.com/atelier-anchor/smiley-sans) |
| Rapier（物理引擎） | Dimforge | Apache-2.0 | [GitHub](https://github.com/dimforge/rapier.js) |
| three.js（3D 画面） | three.js 作者们 | MIT | [GitHub](https://github.com/mrdoob/three.js) |
`;

/** The opening page (index.html, put in by vite.config.js): its 和电脑打 and 和人打 wait for the page to be ready, and the
 *  pot's 3D (potview.js) loads only after that, so it never holds up the first screen. onPick(pvp) gets the choice. */
export function readyIntro(onPick) {
  const intro = document.getElementById('intro'), go = document.getElementById('introGo'), pvp = document.getElementById('introPvp');
  if (!intro) return;
  let closePot = () => {};
  for (const [key, label, two] of [[go, '和电脑打', false], [pvp, '和人打', true]]) {
    key.disabled = false;
    key.querySelector('span').textContent = label;
    key.onclick = () => { onPick?.(two); intro.classList.add('out'); setTimeout(() => { intro.hidden = true; closePot(); closePot = () => {}; }, 220); };
  }
  const hint = document.getElementById('introHint');
  import('./potview.js').then(m => m.showPot(document.getElementById('introModel'), hint)).then(close => {
    if (intro.hidden) close(); else closePot = close;
  }).catch(() => { hint.textContent = '3D 未载入 · 显示改装参考图'; });
}

/** ?pvp=1 goes straight into 一机双人: the opening page is not shown (its pot's 3D is let go as it arrives). */
export function skipIntro() {
  const intro = document.getElementById('intro');
  if (intro) intro.hidden = true;
}

/** Back to the opening page (双人 → 首页). The pot's 3D was let go when the page closed, so its picture stands in. */
export function showIntro() {
  const intro = document.getElementById('intro');
  if (!intro) return false;
  document.querySelector('#introModel img').hidden = false;
  document.getElementById('introHint').textContent = '改装参考图';
  intro.hidden = false;
  requestAnimationFrame(() => intro.classList.remove('out'));
  return true;
}
