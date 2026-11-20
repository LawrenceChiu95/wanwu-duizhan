/**
 * 好友对撞's line to the room service (tools/netplay, Sol #156) and to the other phone. The room service opens and
 * keeps the room and passes messages on; the presses go straight between the phones over a WebRTC data channel when
 * the two can reach each other (the same Wi-Fi), else through the room service (relay). Either way they are the same
 * message (session.js), so which carries them changes nothing but how soon they arrive.
 *
 * Protocol: tools/netplay/README.md and the thread #万物对战:7b81148e (Sol 1bed91b2 46bf6c4e 2523c4d0, Iris aa9b6393).
 */
const KEPT = 'wanwu-netplay-seat';
const ICE = [];  // host candidates only: the same Wi-Fi reaches directly, anything else goes by the room service

export class NetClient {
  constructor({version, url = defaultUrl(), on = {}} = {}) {
    this.version = version;
    this.url = url;
    this.on = on;          // {session, state, game, error, link, warm}
    this.ws = null;
    this.state = null;
    this.seat = null;
    this.code = null;
    this.token = null;
    this.left = false;
    this.rtt = null;       // ms, smoothed
    this.offset = 0;       // server clock - Date.now(), ms
    this.pings = new Map();
    this.samples = [];
    this.dc = null;
    this.pc = null;
    this.direct = false;
    this.retry = 0;
    this.bad = 0;          // messages from the other phone dropped before they got to the game (not JSON, not an object)
  }

  /** A message from the other phone that is not even the shape of one: dropped, counted, noted the first few times. */
  dropped(why) { if (++this.bad <= 5 || this.bad % 100 === 0) console.warn(`好友对撞：丢掉对面一条消息（第 ${this.bad} 条，${why}）`); }

  /** The room this tab was last in (a reload or a lost connection picks it up again). */
  static kept() { try { return JSON.parse(sessionStorage.getItem(KEPT)); } catch { return null; } }

  create() { this.left = false; return this.connect({t: 'create', version: this.version}); }
  join(code) { this.left = false; return this.connect({t: 'join', code: String(code).trim().toUpperCase(), version: this.version}); }
  /** active false: a reloaded page, which says when it is back in the match (presence) once it has put it back. */
  resume(code, token, active) { this.left = false; this.code = code; this.token = token; return this.connect({t: 'resume', code, token, version: this.version, ...(active !== undefined && {active})}); }

  connect(first) {
    this.closeSocket();
    const ws = this.ws = new WebSocket(this.url);
    ws.onopen = () => { this.send(first); this.ping(); };
    ws.onmessage = ev => { let msg; try { msg = JSON.parse(ev.data); } catch { return; } if (msg !== null && typeof msg === 'object') this.receive(msg); };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.ws = null;
      clearInterval(this.pinger);
      if (this.left || !this.token) return;
      // Back on the same seat with its token; the room service keeps it 15 s in a fight, longer while waiting.
      const wait = Math.min(4000, 400 * 2 ** this.retry++);
      this.reconnect = setTimeout(() => { if (!this.left && !this.ws) this.connect({t: 'resume', code: this.code, token: this.token, version: this.version}); }, wait);
    };
  }

  receive(msg) {
    switch (msg.t) {
      case 'session':
        Object.assign(this, {seat: msg.seat, code: msg.code, token: msg.token, retry: 0});
        try { sessionStorage.setItem(KEPT, JSON.stringify({code: msg.code, token: msg.token})); } catch { /* private browsing: no pick-up on reload */ }
        this.pinger = setInterval(() => this.ping(), 1000);
        this.on.session?.(msg);
        break;
      case 'state': {
        const was = this.state;
        this.state = msg;
        if (was?.matchId !== msg.matchId) this.closePeer();
        // Seat 0 starts the direct line once both are in; seat 1 answers. A new one for each loss of it.
        if (this.seat === 0 && !this.pc && msg.seats.every(s => s?.connected)) this.offer();
        this.on.state?.(msg, was);
        break;
      }
      case 'pong': {
        const sent = this.pings.get(msg.n);
        if (sent === undefined) break;
        this.pings.delete(msg.n);
        const now = Date.now(), rtt = now - sent;
        this.rtt = this.rtt === null ? rtt : this.rtt * .8 + rtt * .2;
        // The clock from the quickest of the last few: its half-way guess is the least off.
        this.samples.push({rtt, offset: msg.s - (sent + rtt / 2)});
        if (this.samples.length > 10) this.samples.shift();
        this.offset = this.samples.reduce((a, b) => b.rtt < a.rtt ? b : a).offset;
        break;
      }
      case 'signal': this.signal(msg.d); break;
      case 'relay': if (msg.matchId === undefined || msg.matchId === this.state?.matchId) this.on.game?.(msg.d, 'relay'); break;
      case 'error':
        if (msg.code === 'session' || msg.code === 'room') { this.token = null; try { sessionStorage.removeItem(KEPT); } catch { /* none kept */ } }
        this.on.error?.(msg.code);
        break;
    }
  }

  send(msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  ping() { const n = (this.pingN = (this.pingN ?? 0) + 1); this.pings.set(n, Date.now()); if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value); this.send({t: 'ping', n}); }
  /** The room service's clock, ms: what startAt and resumeAt are given in. */
  serverNow() { return Date.now() + this.offset; }

  /** A message for the other phone: the direct line if it is open, else the room service. */
  game(d) {
    const matchId = this.state?.matchId;
    if (this.dc?.readyState === 'open') { try { this.dc.send(JSON.stringify({m: matchId, d})); return 'direct'; } catch { /* fall through */ } }
    this.send({t: 'relay', matchId, d});
    return 'relay';
  }

  leave() {
    this.left = true;
    this.send({t: 'leave'});
    try { sessionStorage.removeItem(KEPT); } catch { /* none kept */ }
    this.closePeer();
    setTimeout(() => this.closeSocket(), 100);
  }

  closeSocket() { clearTimeout(this.reconnect); clearInterval(this.pinger); const ws = this.ws; this.ws = null; if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already */ } } }

  // ---- the direct line (WebRTC) ----
  peer() {
    if (typeof RTCPeerConnection !== 'function') return null;
    const pc = this.pc = new RTCPeerConnection({iceServers: ICE});
    pc.onicecandidate = ev => { if (ev.candidate) this.send({t: 'signal', d: {ice: ev.candidate.toJSON()}}); };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (['failed', 'closed'].includes(pc.connectionState)) { this.direct = false; this.on.link?.('relay'); }
    };
    pc.ondatachannel = ev => this.channel(ev.channel);
    return pc;
  }
  channel(dc) {
    this.dc = dc;
    dc.onopen = () => { this.direct = true; this.on.link?.('direct'); };
    dc.onclose = () => { if (dc === this.dc) { this.direct = false; this.on.link?.('relay'); } };
    dc.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { this.dropped('not JSON'); return; }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || !('d' in msg)) { this.dropped('no message in it'); return; }
      if (typeof msg.m !== 'string') { this.dropped('no match id'); return; }
      // Another match's (one before a 再来一局, still on its way): nothing wrong with it, just late.
      if (msg.m === this.state?.matchId) this.on.game?.(msg.d, 'direct');
    };
  }
  async offer() {
    const pc = this.peer();
    if (!pc) return;
    // Unordered and never resent: every message carries all that is still unconfirmed (session.js), so a lost one is
    // made up by the next, and a late one never holds up those behind it.
    this.channel(pc.createDataChannel('in', {ordered: false, maxRetransmits: 0}));
    try { await pc.setLocalDescription(await pc.createOffer()); this.send({t: 'signal', d: {sdp: pc.localDescription.toJSON()}}); } catch { this.closePeer(); }
  }
  async signal(d) {
    try {
      if (d?.sdp?.type === 'offer') {
        this.closePeer();
        const pc = this.peer();
        if (!pc) return;
        await pc.setRemoteDescription(d.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        this.send({t: 'signal', d: {sdp: pc.localDescription.toJSON()}});
      } else if (d?.sdp?.type === 'answer') await this.pc?.setRemoteDescription(d.sdp);
      else if (d?.ice) await this.pc?.addIceCandidate(d.ice);
      else if (typeof d?.warm === 'boolean') this.on.warm?.(d.warm);
    } catch { /* a stale or broken offer: the presses go by the room service */ }
  }
  closePeer() { const pc = this.pc; this.pc = this.dc = null; this.direct = false; try { pc?.close(); } catch { /* already */ } }
}

function defaultUrl() {
  if (typeof location === 'undefined') return '';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/netplay/ws`;
}
