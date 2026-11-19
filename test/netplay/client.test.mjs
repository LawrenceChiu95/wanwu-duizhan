import assert from 'node:assert/strict';
import test from 'node:test';
import {NetClient} from '../../web/src/netplay/client.js';

test('a broken message on the direct line is dropped and counted, never thrown, and a good one still comes through', () => {
  const got = [], warn = console.warn;
  console.warn = () => {};
  try {
    const c = new NetClient({url: 'ws://unused', on: {game: (d, via) => got.push([d, via])}});
    c.state = {matchId: 'm1'};
    const dc = {};
    c.channel(dc);
    for (const data of ['null', '5', '"x"', '[]', '{bad', '{}', 'true']) assert.doesNotThrow(() => dc.onmessage({data}), data);
    assert.equal(c.bad, 7);
    dc.onmessage({data: JSON.stringify({m: 'old', d: {k: 'in'}})});
    assert.equal(got.length, 0, 'another match: not passed on');
    dc.onmessage({data: JSON.stringify({m: 'm1', d: {k: 'in', u: 3, p: []}})});
    assert.deepEqual(got, [[{k: 'in', u: 3, p: []}, 'direct']]);
  } finally { console.warn = warn; }
});
