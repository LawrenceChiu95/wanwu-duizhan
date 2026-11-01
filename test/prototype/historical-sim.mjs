// Exact V1 evidence predates MVP's authorized broom length change (1.2 -> 0.8m).
// Re-run the CURRENT V1 engine against its recorded eight-item geometry, so old
// critical/timeout/simultaneous fixtures still test those mechanisms, not seed drift.
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('data/catalog.json',root)));
catalog.items=JSON.parse(await readFile(new URL('./original-catalog-items.json',import.meta.url)));
catalog.itemStandards.broom.longSideMeters=1.2;
let source=await readFile(new URL('sim/index.js',root),'utf8');
source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
source=source.replaceAll("'./math.js'",JSON.stringify(new URL('sim/math.js',root).href));
const from="new URL('../data/catalog.json',import.meta.url)";
if(source.split(from).length!==2)throw Error('Historical catalog patch no longer matches');
source=source.replace(from,`new URL('data:application/json;base64,${Buffer.from(JSON.stringify(catalog)).toString('base64')}')`);
export const {simulate:simulateHistorical}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
