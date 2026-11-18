/**
 * 拍一件's backend, as agreed in 「前端要的任务接口」 第 2 稿 (task #47; Sol c96c3a73, Elara 8d32a2a6): one job from photo to
 * catalog item under /api/shoot/, the pass in X-Shoot-Pass, and a clientKey on the only two calls that can cost quota
 * (建任务 and 重新生成) so a resend gets the same job back. Every call resolves to the job (or quota, items) or throws a
 * ShootError whose code is one of the draft's failure codes, plus 'offline' when the backend can't be reached.
 *
 * ?shoot=fake swaps in the local stand-in (shoot-fake.js) that walks the same states; ?shoot=real talks to the backend.
 * Without either the 拍一件 button stays hidden until the real backend is up (MVP 规格 §6: keys around 11-13). The 评委版
 * talks to its own origin's backend unless the address says ?shoot=fake or ?shoot=off (Elara edd90212).
 *
 * The 评委版 is always inside the studio page's frame, where Safari sends no cookie of the game's own, so whose jobs are
 * whose goes in a header instead (Sol 95ddc8ad e0a86865, Elara 24b57d1e): the first call asks POST /session for a token,
 * kept in localStorage and read back before anything else is sent, then sent as X-Shoot-Session on every call, the
 * photos and models too. A browser that won't keep it (private browsing) doesn't shoot: 暂时不能拍. A token the backend
 * no longer knows (401 session) is kept as it was, with the job, and nothing more is sent: a new identity in the middle
 * could lose the job and pay twice. Only the player starting again on purpose (renew) gets a new one. The normal
 * build's ?shoot=real (the Mac's own address) keeps the cookie.
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

const SESSION_KEY = 'wanwu-shoot-session';

function realApi(base = '/api/shoot', {session: bySession = false} = {}) {
  // lost: the backend said 401 session; unkept: this browser wouldn't keep a token.
  let token = null, starting = null, lost = false, unkept = false;
  if (bySession) try { token = localStorage.getItem(SESSION_KEY); } catch { /* no storage here: asked for below */ }
  const failed = (res, data) => {
    const code = data?.error?.code ?? (res.status === 401 ? 'pass' : [404, 405, 501].includes(res.status) ? 'no-backend' : 'server');
    if (code === 'session' && bySession) lost = true;
    // A quota error says which allowance ran out (generation or recognition) and whose (this browser's or everyone's).
    return new ShootError(code, {activeJobId: data?.activeJobId ?? null, kind: data?.error?.kind ?? null, scope: data?.error?.scope ?? null});
  };
  // This page's token; the first call that needs one asks for it, and calls at the same moment share that request.
  function session() {
    if (lost) return Promise.reject(new ShootError('session'));
    if (unkept) return Promise.reject(new ShootError('storage'));
    if (token) return Promise.resolve(token);
    starting ??= (async () => {
      let res;
      try { res = await fetch(base + '/session', {method: 'POST'}); } catch { throw new ShootError('offline'); }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw failed(res, data);
      if (typeof data?.token !== 'string' || !data.token) throw new ShootError('server');
      let kept = null;
      try { localStorage.setItem(SESSION_KEY, data.token); kept = localStorage.getItem(SESSION_KEY); } catch { /* private browsing */ }
      if (kept !== data.token) { unkept = true; throw new ShootError('storage'); }
      return (token = data.token);
    })().finally(() => { starting = null; });
    return starting;
  }
  const auth = async () => bySession ? {'X-Shoot-Session': await session()} : {};
  const call = async (method, path, body) => {
    const who = await auth();
    let res;
    try {
      res = await fetch(base + path, {method, body: body instanceof FormData ? body : body && JSON.stringify(body),
        // X-Shoot-Category 2: this page knows recognition-missed (Sol 9fc357dd); a page from before it sends 1 or nothing
        // and gets a failure it can retake from.
        headers: {'X-Shoot-Pass': getPass(), 'X-Shoot-Category': '2', ...who, ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})}});
    } catch { throw new ShootError('offline'); }
    const data = await res.json().catch(() => null);
    // No such path or method, and not in the backend's own JSON: this address has no 拍一件 backend behind it (task #62).
    // A gateway's 502 or 504 while the backend is down stays a server error, asked again later.
    if (!res.ok) throw failed(res, data);
    return data;
  };
  // A photo, styled picture or model of this player's: <img> and the model loader can't send the header, so it is
  // fetched with it once per page and handed over as a blob: URL. The token never goes into an address.
  const files = new Map();
  function file(path) {
    if (!bySession || typeof path !== 'string' || !path.startsWith(base + '/files/')) return path;
    if (!files.has(path)) files.set(path, (async () => {
      const who = await auth();
      let res;
      try { res = await fetch(path, {headers: who}); } catch { throw new ShootError('offline'); }
      if (!res.ok) throw failed(res, await res.json().catch(() => null));
      return URL.createObjectURL(await res.blob());
    })().catch(e => { files.delete(path); throw e; }));
    return files.get(path);
  }
  // The two pictures come with the item, so its card has a face at once; the model stays a path, fetched once the game
  // needs it (models.js setFileSource) and started now in the background (Elara c611b379).
  const withFiles = async it => {
    if (!it || typeof it !== 'object') return it;
    const o = it.origin && typeof it.origin === 'object' ? it.origin : null;
    const [photo, styled] = await Promise.all([o && file(o.photo), o && file(o.styled)]);
    Promise.resolve(file(it.glb)).catch(() => {});
    return {...it, ...(o ? {origin: {...o, photo, styled}} : {})};
  };
  return {
    kind: 'real',
    pollMs: 2000,
    now: () => Date.now(),
    // A file of this player's for an <img>: the styled picture while the job is still running (styledUrl).
    fileUrl: async path => file(path),
    async create(photo, clientKey) {
      const form = new FormData();
      form.append('photo', photo);
      form.append('clientKey', clientKey);
      return (await call('POST', '/jobs', form)).job;
    },
    resubmit: async (fromJob, clientKey) => (await call('POST', '/jobs', {fromJob, clientKey})).job,
    job: async id => (await call('GET', `/jobs/${encodeURIComponent(id)}`)).job,
    retry: async id => (await call('POST', `/jobs/${encodeURIComponent(id)}/retry`)).job,
    // 不是它，重拍 between 认物 and generation (task #85; the route is Sol's to settle).
    retake: async id => (await call('POST', `/jobs/${encodeURIComponent(id)}/retake`)).job,
    // 认物 made nothing of it (recognition-missed, Elara a68613bb): the player's pick of the six starts it; Sol 9fc357dd.
    category: async (id, category) => (await call('POST', `/jobs/${encodeURIComponent(id)}/category`, {category})).job,
    regenerate: async (id, clientKey) => (await call('POST', `/jobs/${encodeURIComponent(id)}/regenerate`, {confirm: true, clientKey})).job,
    quota: () => call('GET', '/quota'),
    // The player chose to start again after 401 session: forget the old token; the next call asks for a new one.
    renew() {
      lost = false; token = null; files.clear();
      try { localStorage.removeItem(SESSION_KEY); } catch { /* no storage here */ }
    },
    items: async () => {
      const list = (await call('GET', '/items')).items;
      if (!bySession || !Array.isArray(list)) return list;
      // One item whose file won't come is left out, not the rest; a lost token stops them all.
      const sent = await Promise.all(list.map(it => withFiles(it).catch(e => { if (e.code === 'session') throw e; return undefined; })));
      return sent.filter(it => it !== undefined);
    }
  };
}

/** The backend for this page, or null when 拍一件 is not on yet. */
export async function shootApi(q, judge = false) {
  if (q.get('shoot') === 'fake') return (await import('./shoot-fake.js')).fakeApi(q);
  if (q.get('shoot') === 'real' || (judge && q.get('shoot') !== 'off')) return realApi('/api/shoot', {session: judge});
  return null;
}
