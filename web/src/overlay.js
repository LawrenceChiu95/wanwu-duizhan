import * as THREE from 'three';

const ease = k => 1 - (1 - k) ** 3;

/** DOM effects that live over the canvas. Everything animates from update(realDt) so it can be frozen. */
export class Overlay {
  constructor(stage, els) {
    this.stage = stage;
    this.layer = els.fx;
    this.flashEl = els.flash;
    this.bannerEl = els.banner;
    this.nums = [];
    this.flash = 0;
    this.banner = {age: 0, dur: 0};
    this.marks = [0, 1].map(i => {
      const m = document.createElement('i');
      m.className = `mark m${i}`;
      this.layer.append(m);
      return m;
    });
    this.p = {x: 0, y: 0};
  }

  /** Floating damage number anchored to a world point, drifting up. */
  number(point, text, cls, label) {
    const el = document.createElement('div');
    el.className = `num ${cls}`;
    el.textContent = text;
    if (label) {
      const s = document.createElement('small');
      s.textContent = label;
      el.append(s);
    }
    this.layer.append(el);
    const big = /big|weak/.test(cls);
    // Width (at the largest pop scale) is measured once, to keep the number inside the screen.
    this.nums.push({el, at: new THREE.Vector3().copy(point), age: 0, dur: big ? 1.5 : 1.0, rise: big ? 46 : 34, jitter: (Math.random() - 0.5) * 18, pop: big, half: el.offsetWidth * (big ? 1.3 : 1) / 2});
  }
  screenFlash(amount) { this.flash = Math.max(this.flash, amount); }
  /** Big centred word. 'top' keeps it clear of the impact the camera is centred on. */
  showBanner(text, color, dur = 1.1, place = 'mid') {
    this.bannerEl.classList.toggle('top', place === 'top');
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.banner = {age: 0, dur};
  }
  clear() {
    for (const n of this.nums) n.el.remove();
    this.nums = [];
    this.flash = 0;
    this.banner.dur = 0;
    this.bannerEl.style.opacity = 0;
    this.flashEl.style.opacity = 0;
  }

  update(dt, showMarks) {
    const {stage, p} = this;
    const W = this.layer.clientWidth;
    for (let k = this.nums.length - 1; k >= 0; k--) {
      const n = this.nums[k];
      n.age += dt;
      const t = n.age / n.dur;
      if (t >= 1 || !stage.project(n.at, p)) {
        n.el.remove();
        this.nums.splice(k, 1);
        continue;
      }
      const scale = n.pop ? (t < 0.1 ? 0.6 + 7 * t : 1.3 - Math.min(0.3, (t - 0.1) * 3)) : 1;
      const y = p.y - ease(Math.min(1, t * 1.4)) * n.rise;
      n.el.style.opacity = t > 0.7 ? (1 - t) / 0.3 : 1;
      const x = Math.min(W - 8 - n.half, Math.max(8 + n.half, p.x + n.jitter));
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
    }
    this.flash *= Math.exp(-dt * 11);
    this.flashEl.style.opacity = this.flash > 0.01 ? this.flash.toFixed(3) : 0;
    if (this.banner.dur > 0) {
      this.banner.age += dt;
      const t = this.banner.age / this.banner.dur;
      const o = t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;
      this.bannerEl.style.opacity = o;
      this.bannerEl.style.transform = `scale(${1.25 - 0.25 * ease(Math.min(1, t * 4))})`;
      if (t >= 1) this.banner.dur = 0;
    }
    // Small team-coloured pointer above each fighter, so tiny items stay easy to find.
    this.marks.forEach((m, i) => {
      const f = stage.fighters[i];
      if (!showMarks || !f || !stage.project(f.center, p)) { m.style.opacity = 0; return; }
      const r = Math.min(120, stage.screenRadius(i));
      m.style.opacity = 0.9 * (1 - f.dim);
      m.style.transform = `translate(${p.x - 6}px, ${p.y - r - 16}px)`;
    });
  }
}
