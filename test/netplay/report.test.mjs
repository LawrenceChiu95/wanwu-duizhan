// 好友对撞's desync report (Castor e34c1871): an object the room service takes (tools/netplay/rooms.mjs: a record of up
// to 48 KB), however long the match.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fitReport} from '../../web/src/netplay/session.js';

const bytes = x => Buffer.byteLength(JSON.stringify(x));
const report = n => ({seat: 0, present: n, remoteUpto: n - 3, desync: {step: n - 60, mine: 1, theirs: 2},
  presses: Array.from({length: n}, (_, i) => [i, i % 2, i % 3 ? 'dash' : 'block']), hashes: Array.from({length: n / 60 | 0}, (_, i) => [i * 60, 123456789 + i])});

test('a short report goes as it is, an object', () => {
  const r = report(600), out = fitReport(r);
  assert.equal(typeof out, 'object');
  assert.deepEqual(out.presses, r.presses);
  assert.deepEqual(out.hashes, r.hashes);
  assert.deepEqual(out.dropped, {presses: 0, hashes: 0});
});

test('a long one is cut to size from its oldest presses, the desync and the latest kept', () => {
  const r = report(20000), out = fitReport(r);
  assert.ok(bytes(r) > 48 * 1024);
  assert.ok(bytes(out) <= 46000, `${bytes(out)} bytes`);
  assert.ok(out.dropped.presses > 0);
  assert.equal(out.presses.length + out.dropped.presses, r.presses.length);
  assert.deepEqual(out.presses.at(-1), r.presses.at(-1));
  assert.deepEqual(out.desync, r.desync);
  assert.equal(r.presses.length, 20000, 'the session\'s own log is left whole');
});
