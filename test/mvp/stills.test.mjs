import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// 角色库 card stills (task #39): every item the library offers shows its own picture until its model is drawn. A
// photographed item uses the styled picture from its generation record; every other one needs data/stills/<id>.webp.
const root = new URL('../../', import.meta.url);
const {items} = JSON.parse(await readFile(new URL('data/catalog.json', root), 'utf8'));
const replaced = new Set(items.map(i => i.comparisonBase).filter(Boolean));

test('every offered item without a styled picture has a small WebP still', async () => {
  const need = items.filter(i => !replaced.has(i.id) && !i.origin?.styled);
  assert.ok(need.length > 0);
  for (const item of need) {
    const bytes = await readFile(new URL(`data/stills/${item.id}.webp`, root)).catch(() => null);
    assert.ok(bytes, `${item.name}（${item.id}）缺卡片静态图：开着 dev server 跑 node web/scripts/make-stills.mjs`);
    assert.equal(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 12), 'RIFFWEBP', item.id);
    assert.ok(bytes.length < 60 * 1024, `${item.id}: ${bytes.length} bytes`);
  }
});
