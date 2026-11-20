/**
 * Files fetched with a watch on them (好友对撞 stuck before its start, 19:04: both phones 准备, neither told the room its
 * models were in; Elara 9930fb52, Sol 11:20). A request that brings no byte for STALL_MS (none at all, or none more) is
 * cut off and fails as a cut connection does, so the tries around it (main.js loadAgain) go on by this phone's own clock
 * instead of waiting for ever on a request a phone network holds open. A try after the first (`again`) skips the
 * browser's cache, so it is a new request, not one queued behind the stuck one.
 */
export const STALL_MS = 12000;

export async function fetchSteady(url, again = 0, init = {}) {
  const stop = new AbortController();
  let timer;
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), STALL_MS); };
  watch();
  try {
    const res = await fetch(url, {...init, signal: stop.signal, ...again && {cache: 'no-store'}});
    if (!res.ok) throw Object.assign(Error(`fetch ${url}: ${res.status}`), {status: res.status});
    const reader = res.body.getReader(), parts = [];
    let size = 0;
    for (;;) {
      watch();
      const {done, value} = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    return bytes.buffer;
  } catch (e) {
    throw stop.signal.aborted ? Error(`fetch stalled: ${url}`) : e;
  } finally {
    clearTimeout(timer);
  }
}

// The physics engine's file (vite.config.js routes rapier's own fetch of it here): each start of the engine is a new try.
let engineTries = 0;
export const engineFile = url => fetchSteady(url, engineTries++);
