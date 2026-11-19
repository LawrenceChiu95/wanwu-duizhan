import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {sha256Hex} from '../../web/src/netplay/sha256.js';
import {digest, shareable} from '../../web/src/netplay/friend.js';
import {digest as roomDigest} from '../../tools/netplay/items.mjs';
import {itemSignature} from '../../sim/runtime-items.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const bytes = text => new TextEncoder().encode(text);

test('on plain http (no crypto.subtle) an item hashes the same as with it, and as the room service hashes it', async () => {
  assert.ok(catalog.items.length > 10);
  for (const item of catalog.items) {
    const shared = shareable(item), plain = sha256Hex(bytes(itemSignature(shared)));
    assert.equal(plain, await digest(shared), item.id);
    assert.equal(plain, roomDigest(shared), item.id);
  }
  // Around the 64-byte block edges, and more than one block of 3-byte characters.
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
    const text = '件a'.repeat(n).slice(0, n);
    assert.equal(sha256Hex(bytes(text)), createHash('sha256').update(text).digest('hex'), `length ${n}`);
  }
  assert.equal(sha256Hex(bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
