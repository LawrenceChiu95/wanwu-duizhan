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
