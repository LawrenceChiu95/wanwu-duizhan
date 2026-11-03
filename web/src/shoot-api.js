/**
 * 拍一件's backend, as agreed in 「前端要的任务接口」 第 2 稿 (task #47; Sol c96c3a73, Elara 8d32a2a6): one job from photo to
 * catalog item under /api/shoot/, the pass in X-Shoot-Pass, and a clientKey on the only two calls that can cost quota
 * (建任务 and 重新生成) so a resend gets the same job back. Every call resolves to the job (or quota, items) or throws a
 * ShootError whose code is one of the draft's failure codes, plus 'offline' when the backend can't be reached.
 *
 * ?shoot=fake swaps in the local stand-in (shoot-fake.js) that walks the same states; ?shoot=real talks to the backend.
 * Without either the 拍一件 button stays hidden until the real backend is up (MVP 规格 §6: keys around 11-13).
 */
export class ShootError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const PASS_KEY = 'wanwu-shoot-pass';
export const getPass = () => { try { return localStorage.getItem(PASS_KEY) ?? ''; } catch { return ''; } };
export const setPass = pass => { try { localStorage.setItem(PASS_KEY, pass); } catch { /* no storage here */ } };

/**
 * A photo, decoded for drawing onto a canvas. The published copy has no createImageBitmap (pack-artifact.mjs turns it off
 * for three.js), so there it goes through an <img> from a data: URL, which the viewer allows.
 */
export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const src = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
  const img = new Image();
  img.src = src;
  await img.decode();
  return Object.assign(img, {width: img.naturalWidth, height: img.naturalHeight});
}

/** A random id for one submission: resent as is, it can only ever get the same job back. */
export const newClientKey = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function realApi(base = '/api/shoot') {
  const call = async (method, path, body) => {
    let res;
    try {
      res = await fetch(base + path, {method, body: body instanceof FormData ? body : body && JSON.stringify(body),
        headers: {'X-Shoot-Pass': getPass(), ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})}});
    } catch { throw new ShootError('offline'); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ShootError(data?.error?.code ?? (res.status === 401 ? 'pass' : 'server'), {activeJobId: data?.activeJobId ?? null});
    return data;
  };
  return {
    kind: 'real',
    pollMs: 2000,
    now: () => Date.now(),
    async create(photo, clientKey) {
      const form = new FormData();
      form.append('photo', photo);
      form.append('clientKey', clientKey);
      return (await call('POST', '/jobs', form)).job;
    },
    resubmit: async (fromJob, clientKey) => (await call('POST', '/jobs', {fromJob, clientKey})).job,
    job: async id => (await call('GET', `/jobs/${encodeURIComponent(id)}`)).job,
    retry: async id => (await call('POST', `/jobs/${encodeURIComponent(id)}/retry`)).job,
    regenerate: async (id, clientKey) => (await call('POST', `/jobs/${encodeURIComponent(id)}/regenerate`, {confirm: true, clientKey})).job,
    quota: () => call('GET', '/quota'),
    items: async () => (await call('GET', '/items')).items
  };
}

/** The backend for this page, or null when 拍一件 is not on yet. */
export async function shootApi(q) {
  if (q.get('shoot') === 'fake') return (await import('./shoot-fake.js')).fakeApi(q);
  if (q.get('shoot') === 'real') return realApi();
  return null;
}
