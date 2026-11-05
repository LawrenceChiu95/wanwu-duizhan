/**
 * 评委版 (task #4, Elara 51c72819): `npm run build:judge` builds this page with __JUDGE__ on. A judge opens a link on a
 * phone and plays with the nine default items; nothing calls a backend, so the static files keep working on any host.
 * 拍一件 doesn't shoot: it replays one real generation (this flip-flop: a real photo through 认物, 改图 and 建模, Sol's
 * task 26 run, job j_a3187a76), so a judge sees the items come from photos without being handed a made-up one.
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
export const showcase = {
  ...itemJson,
  glb: bundled(itemJson.glb),
  origin: {...itemJson.origin, photo: bundled(itemJson.origin.photo), styled: bundled(itemJson.origin.styled)}
};

// The photo is a public one, not the player's (Sol 384ad535); 素材署名 and the replay both say whose it is.
export const photoCredit = '原照 Michal Osmenda · CC BY-SA 2.0，已裁切、改图并建模';
export const creditsMd = `
## 拍一件示例：人字拖
| 素材 | 作者 | 许可 | 来源 |
|---|---|---|---|
| 人字拖原照（已裁切、改图并建模） | Michal Osmenda | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Flip-flops_(3409558121).jpg) |
`;

/** The opening card (index.html, put in by vite.config.js): its 开始玩 waits for the page to be ready. */
export function readyIntro() {
  const intro = document.getElementById('intro'), go = document.getElementById('introGo');
  if (!intro) return;
  go.disabled = false;
  go.querySelector('span').textContent = '开始玩';
  go.onclick = () => { intro.classList.add('out'); setTimeout(() => { intro.hidden = true; }, 220); };
}
