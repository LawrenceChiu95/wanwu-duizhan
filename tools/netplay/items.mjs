import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {itemSignature, validateRuntimeItem} from '../../sim/runtime-items.js';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const catalog = load('../../data/catalog.json');
const rules = load('../../sim/v3-rules.json');
const builtIn = new Map(catalog.items.map(item => [item.id, item]));
const photoId = /^shoot_[a-f0-9-]{36}$/;
const token = /^[a-f0-9-]{36}\.[a-f0-9]{64}$/;
const fields = ['id', 'name', 'category', 'tag', 'condition', 'material', 'materialName',
  'scale', 'mass', 'volume', 'massBasis', 'generated', 'photoPhysics', 'outEnd',
  'bounds', 'hull', 'weakPoint', 'rating', 'stats', 'standardLongSide'];

export class RoomError extends Error {}

export const digest = value => createHash('sha256').update(itemSignature(value)).digest('hex');

function partList(parts) {
  if (!Array.isArray(parts) || parts.length > 2) throw new RoomError('parts');
  const ids = new Set(), mounts = new Set();
  return parts.map(part => {
    if (!part || typeof part.item !== 'string' || part.item.length > 128 ||
        typeof part.mount !== 'string' || !Object.hasOwn(rules.top.slots, part.mount) ||
        !rules.top.orients.includes(part.orient) || ids.has(part.item) || mounts.has(part.mount)) {
      throw new RoomError('parts');
    }
    ids.add(part.item);
    mounts.add(part.mount);
    return {item: part.item, mount: part.mount, orient: part.orient};
  });
}

export async function selectItems({code, matchId, parts, shootSession, shoot}) {
  const selected = partList(parts);
  const photoIds = selected.filter(part => !builtIn.has(part.item)).map(part => part.item);
  const privateModels = new Map();
  if (photoIds.length) {
    if (!shoot || !photoIds.every(id => photoId.test(id)) ||
        typeof shootSession !== 'string' || !token.test(shootSession)) throw new RoomError('item');
    const response = await shoot('/api/shoot/items', {headers: {'x-shoot-session': shootSession}});
    if (!response.ok) {
      await response.body?.cancel();
      throw new RoomError(response.status === 401 ? 'item' : 'shoot-offline');
    }
    const {items} = await response.json();
    if (!Array.isArray(items)) throw new RoomError('shoot-offline');
    for (const id of photoIds) {
      const item = items.find(it => it?.id === id);
      if (!item) throw new RoomError('item');
      const source = '/api/shoot/files/' + id + '/model.glb';
      if (item.glb !== source) throw new RoomError('item');
      // The owner credential stays on the server for this match and goes only to 4331.
      privateModels.set(id, {item: validateRuntimeItem(item, catalog), source, shootSession});
    }
  }

  const items = selected.map(({item: id}) => {
    const photo = privateModels.get(id);
    const source = photo?.item ?? builtIn.get(id);
    const item = Object.fromEntries(fields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
    const model = photo ? `/api/netplay/models/${code}/${matchId}/${id}` : null;
    return {item, hash: digest(item), model};
  });
  return {loadout: {parts: selected, items}, privateModels};
}

export function prepareMatch({version, matchId, seed, seats}) {
  const loadouts = seats.map(seat => seat.selection.loadout);
  const hash = digest({
    version, matchId, seed,
    loadouts: loadouts.map(({parts, items}) => ({parts, itemHashes: items.map(({hash}) => hash)}))
  });
  return {loadouts, hash};
}
