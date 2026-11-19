/**
 * 评委版 (task #4, Elara 51c72819): `npm run build:judge` builds this page with __JUDGE__ on. A judge opens a link on a
 * phone and plays with the default items, and 拍一件 shoots through the backend at the same origin (Elara edd90212);
 * when it can't now, those still play. Beside 拍照 is one real generation to replay and to play with (Elara 9e17f724,
 * 9c352da4): the thermos Wren shot on the live link on 11-18 (job j_9a023f5d, Elara 615e1aa1). The flip-flop made from a public photo went with 素材署名
 * (远夏 51af182b, Elara 17ed7f8b): without the credits, nothing under someone else's licence ships. A build kept on a
 * phone that names it waits like a photo item that has not come in: the default stands in and the kept one stays until
 * the player changes that side. With ?shoot=off nothing calls a backend and 拍一件 is the thermos only.
 * Loaded only when __JUDGE__ is on, so its pictures and model stay out of the normal build.
 */
import thermosJson from '../../data/showcase/thermos/item.json';
import thermosGlb from '../../data/showcase/thermos/model.glb?url';
import thermosPhoto from '../../data/showcase/thermos/photo.webp?url';
import thermosStyled from '../../data/showcase/thermos/styled.webp?url';

// The item as the page uses it: the backend's record with its files swapped for the bundled URLs. Steps are the
// generation's own times, as the backend logged them.
const bundle = (json, glb, photo, styled, extra = {}) => ({...json, ...extra, glb, origin: {...json.origin, photo, styled}});
// tag says whose photo it is, beside the replay; credit is the line under it (Elara 9c352da4).
export const showcases = [
  {item: bundle(thermosJson, thermosGlb, thermosPhoto, thermosStyled), tag: '我们真拍', own: true,
    credit: '我们用手机真拍的照片；认物、改图和建模都是真跑的'}
];

/** The opening page (index.html, put in by vite.config.js): its 和电脑打 and 和人打 wait for the page to be ready, and the
 *  pot's 3D (potview.js) loads only after that, so it never holds up the first screen. onPick(pvp) gets the choice;
 *  「拍一件试试」 is 和电脑打 with onShoot()'s answer after it (Elara ee609025): onShoot is called at the tap itself, so
 *  whatever it notes then holds for the wait (Sol f143b0e8). */
let closePot = () => {};
// The pot's 3D into its box, once per showing of the page: let go when the page closes, built again when it comes back
// (Castor, Elara 3d42a0c1: back from a match it stayed the still).
function loadPot() {
  const intro = document.getElementById('intro'), hint = document.getElementById('introHint'), req = closePot = () => {};
  import('./potview.js').then(m => m.showPot(document.getElementById('introModel'), hint, document.getElementById('introHull'),
    () => closePot === req && !intro.hidden)).then(close => {
    if (intro.hidden || closePot !== req) close(); else closePot = close;
  }).catch(() => { hint.textContent = '3D 未载入 · 显示改装参考图'; });
}
export function readyIntro(onPick, onShoot) {
  const intro = document.getElementById('intro'), go = document.getElementById('introGo'), pvp = document.getElementById('introPvp');
  if (!intro) return;
  const leave = () => { intro.classList.add('out'); setTimeout(() => { intro.hidden = true; closePot(); closePot = () => {}; }, 220); };
  for (const [key, label, two] of [[go, '和电脑打', false], [pvp, '和人打', true]]) {
    key.disabled = false;
    key.querySelector('span').textContent = label;
    key.onclick = () => { onPick?.(two); leave(); };
  }
  const shoot = document.getElementById('introShoot');
  if (shoot) { shoot.disabled = false; shoot.onclick = () => { const then = onShoot?.(); onPick?.(false)?.then?.(then); leave(); }; }
  loadPot();
}

/**
 * 好友对撞 (docs/netplay-spec.md): a third, quieter key under the two, only on an address with the room service (main.js
 * asks it first), so the 评委版 link looks as it did. It leaves the opening page as the two do.
 */
export function friendKey(onPick) {
  const intro = document.getElementById('intro'), modes = intro?.querySelector('.kmodes');
  if (!modes || document.getElementById('introFriend')) return;
  const key = document.createElement('button');
  key.type = 'button';
  key.className = 'kfriend';
  key.id = 'introFriend';
  key.innerHTML = '<span>好友对撞</span><small>两台手机，扫码连上</small><b aria-hidden="true">→</b>';
  key.onclick = () => { onPick?.(); intro.classList.add('out'); setTimeout(() => { intro.hidden = true; closePot(); closePot = () => {}; }, 220); };
  modes.after(key);
}

/** ?pvp=1 goes straight into 一机双人: the opening page is not shown (its pot's 3D is let go as it arrives). */
export function skipIntro() {
  const intro = document.getElementById('intro');
  if (intro) intro.hidden = true;
}

/** Back to the opening page (双人 → 首页): the still stands in again while the pot's 3D is built anew. */
export function showIntro() {
  const intro = document.getElementById('intro');
  if (!intro) return false;
  document.querySelector('#introModel img').hidden = false;
  document.getElementById('introHint').textContent = '3D 稍后载入';
  intro.hidden = false;
  requestAnimationFrame(() => intro.classList.remove('out'));
  loadPot();
  return true;
}
