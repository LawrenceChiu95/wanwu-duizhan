import test from 'node:test';
import assert from 'node:assert/strict';
import {BreakHolds} from '../src/break-holds.js';

const brk = {type: 'break', target: 1, targetPart: 'part-1'};

test('a batch that breaks the piece holds the break until it lands', () => {
  const h = new BreakHolds(), b = h.shoot('1:part-1', true);
  assert.equal(h.isHeld('1:part-1'), true);
  assert.equal(h.hold('1:part-1', brk), true);
  assert.equal(h.land(b), brk);
  assert.equal(h.isHeld('1:part-1'), false);
});

test('a batch that only hurts the piece holds nothing: a later blow breaks it at once', () => {
  const h = new BreakHolds(), b = h.shoot('1:part-1', false);
  assert.equal(h.isHeld('1:part-1'), false);
  assert.equal(h.hold('1:part-1', brk), false);
  assert.equal(h.land(b), null);
});

test('first batch only hurts, second breaks: the first landing neither takes the break nor lets the piece go', () => {
  const h = new BreakHolds(), first = h.shoot('1:part-1', false), second = h.shoot('1:part-1', true);
  assert.equal(h.hold('1:part-1', brk), true);
  assert.equal(h.land(first), null);
  assert.equal(h.isHeld('1:part-1'), true);
  assert.equal(h.land(second), brk);
  assert.equal(h.isHeld('1:part-1'), false);
});

test('a new match or a jump in the replay drops every hold', () => {
  const h = new BreakHolds(), b = h.shoot('1:part-1', true);
  h.hold('1:part-1', brk);
  h.clear();
  assert.equal(h.isHeld('1:part-1'), false);
  assert.equal(h.land(b), null);
});
