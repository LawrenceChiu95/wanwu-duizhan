import {randomBytes, randomInt, randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {prepareMatch, RoomError, selectItems} from './items.mjs';

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const roomCode = /^[23456789A-HJ-NP-Z]{6}$/;
const version = /^[A-Za-z0-9_.-]{1,80}$/;
const resultHash = value => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff ||
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const winner = value => value === 0 || value === 1 || value === null;
const active = seat => Boolean(seat?.ws) && seat.visible;
const maxClients = 256;
const maxRooms = 100;
const maxBuffered = 256 * 1024;
const waitBeforeReady = 1000;
const readyAnimation = 1500;
const heartbeatEvery = 3000;
const idleTimeout = 10 * 60_000;
const playingTimeout = 4 * 60_000;

export function mountRooms(server, {origin, shoot, storeTrace, now = Date.now, graceMs = 15_000, tickMs = 200}) {
  const rooms = new Map();
  const sockets = new WebSocketServer({noServer: true, maxPayload: 64 * 1024});
  const send = (ws, frame) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > maxBuffered) return ws.terminate();
    ws.send(JSON.stringify(frame));
  };
  const error = (ws, code) => send(ws, {t: 'error', code});
  const states = room => ({
    t: 'state', code: room.code, phase: room.phase, matchId: room.matchId, version: room.version, seed: room.seed,
    seats: room.seats.map(seat => seat ? {connected: active(seat), ready: Boolean(seat.selection)} : null),
    prepare: room.prepare, startAt: room.startAt, resumeAt: room.resumeAt,
    pausedSeat: room.pausedSeat, deadline: room.deadline, winner: room.winner, reason: room.reason
  });
  const publish = room => {
    const state = states(room);
    for (const seat of room.seats) send(seat?.ws, state);
  };
  const reset = (room, phase) => {
    Object.assign(room, {
      phase, matchId: randomUUID(), seed: randomBytes(4).readUInt32LE(),
      prepare: null, startAt: null, resumeAt: null, pausedSeat: null,
      deadline: null, winner: null, reason: null, priorPhase: null, expires: now() + idleTimeout
    });
    for (const seat of room.seats.filter(Boolean)) {
      Object.assign(seat, {selection: null, assets: false, rematch: false, result: null, traced: false, checking: null});
    }
  };

  function finish(room, who, reason) {
    Object.assign(room, {phase: 'finished', winner: who, reason, pausedSeat: null, deadline: null, resumeAt: null, expires: now() + idleTimeout});
    publish(room);
  }

  function remove(room) {
    rooms.delete(room.code);
    for (const seat of room.seats) {
      const ws = seat?.ws;
      if (ws) {
        ws.room = null;
        ws.close(1000, 'room closed');
      }
    }
  }

  function checkPresence(room) {
    const time = now();
    if (room.phase === 'paused' && time >= room.deadline) {
      const present = room.seats.map(active);
      finish(room, present[0] === present[1] ? null : present[0] ? 0 : 1, 'disconnect');
      return;
    }

    const absent = room.seats.findIndex(seat => !active(seat));
    if (room.phase === 'paused' && absent === -1) {
      const phase = room.priorPhase;
      const resumeAt = phase === 'playing' ? time + waitBeforeReady : null;
      Object.assign(room, {phase, pausedSeat: null, deadline: null, priorPhase: null, resumeAt});
      if (phase === 'countdown') room.startAt = time + waitBeforeReady;
      if (phase === 'playing') room.expires = time + playingTimeout;
    } else if (absent !== -1 && ['countdown', 'playing'].includes(room.phase)) {
      Object.assign(room, {priorPhase: room.phase, phase: 'paused', pausedSeat: absent, deadline: time + graceMs, resumeAt: null});
    }
    if (room.phase === 'waiting' || room.phase === 'loadout' || room.phase === 'preparing') {
      room.expires = time + idleTimeout;
    }
    publish(room);
    if (absent === -1) {
      maybePrepare(room);
      maybeStart(room);
    }
  }

  function attach(ws, room, seat) {
    const old = seat.ws;
    Object.assign(seat, {ws, visible: true, checking: null});
    Object.assign(ws, {room, seat});
    if (old && old !== ws) {
      old.room = null;
      old.close(1000, 'replaced');
    }
    send(ws, {t: 'session', code: room.code, seat: seat.index, token: seat.token});
    checkPresence(room);
  }

  function enroll(ws, msg) {
    if (msg.t === 'create') {
      if (typeof msg.version !== 'string' || !version.test(msg.version)) throw new RoomError('version');
      if (rooms.size >= maxRooms) throw new RoomError('busy');
      let code;
      do {
        code = Array.from({length: 6}, () => alphabet[randomInt(alphabet.length)]).join('');
      } while (rooms.has(code));
      const room = {code, version: msg.version, seats: [newSeat(0), null]};
      reset(room, 'waiting');
      rooms.set(code, room);
      attach(ws, room, room.seats[0]);
      return;
    }
    if (msg.t !== 'join' && msg.t !== 'resume') throw new RoomError('session');
    const code = typeof msg.code === 'string' && msg.code.toUpperCase();
    const room = code && roomCode.test(code) && rooms.get(code);
    if (!room || now() >= room.expires) throw new RoomError('room');
    if (msg.t === 'resume') {
      if (typeof msg.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(msg.token)) throw new RoomError('session');
      const seat = room.seats.find(seat => seat?.token === msg.token);
      if (!seat || (msg.version !== undefined && msg.version !== room.version)) throw new RoomError('session');
      if (room.phase === 'paused' && now() >= room.deadline) checkPresence(room);
      attach(ws, room, seat);
      return;
    }
    if (msg.version !== room.version) throw new RoomError('version');
    if (room.phase !== 'waiting' || room.seats[1]) throw new RoomError('full');
    room.seats[1] = newSeat(1);
    reset(room, 'loadout');
    attach(ws, room, room.seats[1]);
  }

  function newSeat(index) {
    return {index, token: randomBytes(32).toString('base64url')};
  }

  function maybePrepare(room) {
    if (room.phase !== 'loadout' || !room.seats.every(seat => active(seat) && seat.selection)) return;
    room.prepare = prepareMatch(room);
    room.phase = 'preparing';
    publish(room);
  }

  function maybeStart(room) {
    if (room.phase !== 'preparing' || !room.seats.every(seat => active(seat) && seat.assets)) return;
    Object.assign(room, {phase: 'countdown', startAt: now() + waitBeforeReady});
    publish(room);
  }

  async function ready(ws, room, seat, msg) {
    if (seat.selection || seat.checking) throw new RoomError('ready');
    if (room.phase !== 'loadout' || msg.matchId !== room.matchId) throw new RoomError('phase');
    const pending = {};
    seat.checking = pending;
    try {
      let selection;
      try {
        selection = await selectItems({code: room.code, matchId: room.matchId, parts: msg.parts, shootSession: msg.shootSession, shoot});
      } catch (cause) {
        if (cause instanceof RoomError) throw cause;
        throw new RoomError('shoot-offline');
      }
      if (seat.checking !== pending || seat.ws !== ws || ws.room !== room ||
          msg.matchId !== room.matchId || room.phase !== 'loadout') return;
      seat.selection = selection;
      publish(room);
      maybePrepare(room);
    } finally {
      if (seat.checking === pending) seat.checking = null;
    }
  }

  function store(room, seat, step, log) {
    if (!storeTrace || seat.traced || !Number.isSafeInteger(step) || step < 0 || !record(log)) return;
    if (Buffer.byteLength(JSON.stringify(log)) > 48 * 1024) throw new RoomError('trace');
    seat.traced = true;
    const matchId = room.matchId;
    Promise.resolve(storeTrace({matchId, seat: seat.index, at: now(), step, log})).catch(() => {
      if (room.matchId !== matchId) return;
      seat.traced = false;
      error(seat.ws, 'trace-store');
    });
  }

  async function message(ws, msg) {
    if (!record(msg) || typeof msg.t !== 'string') throw new RoomError('message');
    if (msg.t === 'ping') {
      if (!Number.isSafeInteger(msg.n)) throw new RoomError('message');
      return send(ws, {t: 'pong', n: msg.n, s: now()});
    }
    const {room, seat} = ws;
    if (!room) return enroll(ws, msg);
    if (msg.t === 'leave') {
      ws.room = null;
      seat.ws = null;
      seat.visible = false;
      seat.token = null;
      ws.close(1000, 'left');
      if (room.phase === 'waiting' || !room.seats.some(active)) return remove(room);
      if (room.phase !== 'finished') finish(room, 1 - seat.index, 'disconnect');
      return publish(room);
    }
    if (msg.t === 'presence') {
      if (typeof msg.active !== 'boolean') throw new RoomError('message');
      if (seat.visible !== msg.active) {
        if (room.phase === 'paused' && now() >= room.deadline) checkPresence(room);
        seat.visible = msg.active;
        checkPresence(room);
      }
      return;
    }
    if (msg.matchId !== undefined && msg.matchId !== room.matchId) throw new RoomError('match');

    switch (msg.t) {
      case 'signal':
      case 'relay': {
        if (msg.d === undefined || !room.seats[1]) throw new RoomError('message');
        if (msg.t === 'relay' && !['countdown', 'playing', 'paused'].includes(room.phase)) return;
        const frame = {t: msg.t, from: seat.index, d: msg.d};
        if (msg.matchId !== undefined) frame.matchId = msg.matchId;
        return send(room.seats[1 - seat.index].ws, frame);
      }
      case 'ready':
        return ready(ws, room, seat, msg);
      case 'assetsReady':
        if (room.phase !== 'preparing') throw new RoomError('phase');
        if (msg.matchId !== room.matchId || msg.hash !== room.prepare.hash) throw new RoomError('assets');
        seat.assets = true;
        return maybeStart(room);
      case 'result': {
        if (room.phase === 'finished') return;
        if (msg.matchId !== room.matchId || !winner(msg.winner) || !resultHash(msg.hash)) throw new RoomError('result');
        if (room.phase !== 'playing' && !(room.phase === 'paused' && room.priorPhase === 'playing')) throw new RoomError('phase');
        seat.result ??= {winner: msg.winner, hash: msg.hash};
        const other = room.seats[1 - seat.index].result;
        if (!other) return;
        if (other.winner !== seat.result.winner || other.hash !== seat.result.hash) return finish(room, null, 'desync');
        return finish(room, other.winner, 'complete');
      }
      case 'desync':
        if (msg.matchId !== room.matchId || (room.phase !== 'playing' && room.phase !== 'finished' && room.priorPhase !== 'playing')) throw new RoomError('phase');
        if (!Number.isSafeInteger(msg.step) || msg.step < 0 || !record(msg.log)) throw new RoomError('trace');
        store(room, seat, msg.step, msg.log);
        if (room.phase !== 'finished') return finish(room, null, 'desync');
        return;
      case 'rematch':
        if (room.phase !== 'finished' || msg.matchId !== room.matchId || !room.seats.every(active)) throw new RoomError('phase');
        seat.rematch = true;
        if (room.seats.every(s => s.rematch)) {
          reset(room, 'loadout');
          publish(room);
        }
        return;
      default:
        throw new RoomError('message');
    }
  }

  sockets.on('connection', ws => {
    ws.on('error', () => {});
    ws.opened = ws.lastPong = ws.rateStarted = now();
    ws.count = 0;
    ws.on('pong', () => { ws.lastPong = now(); });
    ws.on('message', (bytes, binary) => {
      if (now() - ws.rateStarted >= 1000) {
        ws.rateStarted = now();
        ws.count = 0;
      }
      if (++ws.count > 250) return ws.close(1008, 'message rate');
      if (binary) return error(ws, 'message');
      let msg;
      try { msg = JSON.parse(bytes); } catch { return error(ws, 'message'); }
      message(ws, msg).catch(cause => error(ws, cause instanceof RoomError ? cause.message : 'internal'));
    });
    ws.on('close', () => {
      if (!ws.room || ws.seat.ws !== ws) return;
      ws.seat.ws = null;
      ws.seat.checking = null;
      checkPresence(ws.room);
    });
  });

  function upgrade(req, socket, head) {
    if (req.url !== '/api/netplay/ws' || req.headers.origin !== origin || sockets.clients.size >= maxClients) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  }
  server.on('upgrade', upgrade);

  const tick = setInterval(() => {
    const time = now();
    for (const room of rooms.values()) {
      if (time >= room.expires) remove(room);
      else if (room.phase === 'paused' && time >= room.deadline) checkPresence(room);
      else if (room.phase === 'countdown' && time >= room.startAt + readyAnimation) {
        Object.assign(room, {phase: 'playing', expires: time + playingTimeout});
        publish(room);
      }
    }
  }, tickMs).unref();

  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if ((!ws.room && now() - ws.opened >= heartbeatEvery * 2) || now() - ws.lastPong >= heartbeatEvery * 2) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, heartbeatEvery).unref();

  return {
    model(code, id, itemId, seatToken) {
      const room = rooms.get(code);
      if (!room || id !== room.matchId || typeof seatToken !== 'string' ||
          !room.seats.some(seat => seat?.token === seatToken)) return null;
      if (!room.prepare) return null;
      return room.seats.map(seat => seat?.selection?.privateModels.get(itemId)).find(Boolean) ?? null;
    },
    close() {
      clearInterval(tick);
      clearInterval(heartbeat);
      server.off('upgrade', upgrade);
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
    }
  };
}
