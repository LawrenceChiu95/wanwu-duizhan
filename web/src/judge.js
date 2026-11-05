/**
 * 评委版 (task #4, Elara 51c72819): `npm run build:judge` builds this page with __JUDGE__ on. A judge opens a link on a
 * phone and plays with the nine default items, and 拍一件 shoots through the backend at the same origin (Elara edd90212);
 * when it can't now, the nine still play. Beside 拍照 is one real generation to replay (this flip-flop: a real photo
 * through 认物, 改图 and 建模, Sol's task 26 run, job j_a3187a76), so a judge sees how an item comes from a photo before
 * trying, or instead. With ?shoot=off nothing calls a backend and 拍一件 is only that replay.
 * Loaded only when __JUDGE__ is on, so its pictures and model stay out of the normal build.
 */
import itemJson from '../../data/showcase/flipflop/item.json';
import glbUrl from '../../data/showcase/flipflop/model.glb?url';
import photoUrl from '../../data/showcase/flipflop/photo.webp?url';
import styledUrl from '../../data/showcase/flipflop/styled.webp?url';

const files = {'model.glb': glbUrl, 'photo.webp': photoUrl, 'styled.webp': styledUrl};
const bundled = path => files[path.split('/').pop()];

// The item as the page uses it: the catalog-style record with its files swapped for the bundled URLs. Steps are the
// generation's own times, without the 155 s the run stood still while the credits were checked by hand (Sol 378c66c6).
// Its 3D swings about the upright instead of turning (livecards.js): the model stands on its sole's edge, so it starts
// three-quarter like the opening card's picture, straps showing, and never turns its sole to the camera (Elara 907b6fa5).
export const showcase = {
  ...itemJson,
  card: {swing: 0.7},
  glb: bundled(itemJson.glb),
  origin: {...itemJson.origin, photo: bundled(itemJson.origin.photo), styled: bundled(itemJson.origin.styled)}
};

// The photo is a public one, not the player's (Sol 384ad535); 素材署名 and the replay both say whose it is.
export const photoCredit = '原照 Michal Osmenda · CC BY-SA 2.0，已裁切、改图并建模';
// 素材署名 in this build (Elara 907b6fa5): Chinese, only what the judges get, one line per thing. The five Lux3D items list
// the photo each was made from: 锅 and 废土锅 share docoverachiever's cast-iron pan (Wren's imgs/meta.json pan-2.jpg; checked
// against the Flickr page — data/lux3d/RECEIPT.md named kevin dooley's「Frying pan」, which is pan-0); 废土扫把's photo is
// 1024greenstreet's (Wren 520f0486, 开发归档/素材署名-原照溯源).
const CC = {'by-2': '[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)', 'by-3': '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)',
  'by-4': '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)', 'by-sa-2': '[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)'};
export const creditsMd = `
## 角色
| 角色 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 锅（照片 → Lux3D 生成） | 原照 docoverachiever | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/90692748@N04/47347731882) |
| 台灯（照片 → Lux3D 生成） | 原照 Artdecodude | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/62920259@N03/5771792573) |
| 废土刀（照片 → Lux3D 生成） | 凡朔 | 本队自制 | |
| 废土锅（照片 → Lux3D 生成） | 原照 docoverachiever | ${CC['by-2']} | [Flickr](https://www.flickr.com/photos/90692748@N04/47347731882) |
| 废土扫把（照片 → Lux3D 生成，原照的柄出画，改图时补全） | 原照 1024greenstreet | ${CC['by-sa-2']} | [Flickr](https://www.flickr.com/photos/82432653@N00/858454965) |
| 扫把 | Poly by Google | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/bzCi_ZLQPN4) |
| 剪刀 | Zsky | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/RRyFBBtM2K) |
| 拖鞋 | inciprocal | ${CC['by-4']} | [Sketchfab](https://sketchfab.com/3d-models/worn-flip-flop-000074a334c541878360457c672b6c2e) |
| 拖鞋的碰撞外形 | J-Toastie | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/2wR1M99UwP) |
| 枕头 | Poly by Google | ${CC['by-3']} | [Poly Pizza](https://poly.pizza/m/f60emm1Xkas) |

Lux3D 生成的五件由 Aholo Lux3D 从照片生成，按 Aholo 黑客松条款使用。模型都统一了尺寸和朝向。

## 拍一件示例
| 素材 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 人字拖原照（已裁切、改图并建模） | Michal Osmenda | ${CC['by-sa-2']} | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Flip-flops_%283409558121%29.jpg) |

## 字体和程序
| 名字 | 作者 | 许可 | 出处 |
|---|---|---|---|
| 得意黑（字体） | atelierAnchor | [SIL OFL 1.1](https://scripts.sil.org/OFL) | [GitHub](https://github.com/atelier-anchor/smiley-sans) |
| Rapier（物理引擎） | Dimforge | Apache-2.0 | [GitHub](https://github.com/dimforge/rapier.js) |
| three.js（3D 画面） | three.js 作者们 | MIT | [GitHub](https://github.com/mrdoob/three.js) |
`;

/** The opening card (index.html, put in by vite.config.js): its 开始玩 waits for the page to be ready. */
export function readyIntro() {
  const intro = document.getElementById('intro'), go = document.getElementById('introGo');
  if (!intro) return;
  go.disabled = false;
  go.querySelector('span').textContent = '开始玩';
  go.onclick = () => { intro.classList.add('out'); setTimeout(() => { intro.hidden = true; }, 220); };
}
