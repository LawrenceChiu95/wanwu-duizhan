import {isDeepStrictEqual} from 'node:util';
// The owner records all previously used seeds before the batch; this checks that declared boundary.
export const physicsFiles=['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','sim/item-rating.js','data/catalog.json','data/default-item-designs.json'];
export const protocolFiles=['test/v3-top/v13/experiment.mjs','test/mvp/batch.mjs'];
const range=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=a&&b<0x100000000;
export function fairFreezeChecks(manifest,freeze){
 const record=typeof freeze?.authority==='string'&&freeze.authority.trim().length>0;
 const seedRange=range(freeze?.seedStart,freeze?.seedEnd)&&Number.isInteger(manifest.n)&&manifest.n>=1000&&manifest.seedStart===freeze.seedStart&&manifest.n===freeze.seedEnd-freeze.seedStart+1;
 const snapshot=Boolean(freeze)&&isDeepStrictEqual(manifest.freeze,freeze);
 const used=freeze?.usedSeedRanges;
 const usedRangesRecorded=Array.isArray(used)&&used.length>0&&used.every(r=>Array.isArray(r)&&r.length===2&&range(...r));
 const unseenSeeds=seedRange&&usedRangesRecorded&&used.every(([a,b])=>freeze.seedEnd<a||freeze.seedStart>b);
 const planned=manifest.stage==='fair'&&seedRange&&freeze.plannedGames===12*manifest.n&&manifest.planned===freeze.plannedGames;
 const physics=physicsFiles.map(file=>({file,expected:freeze?.physics?.[file]??null,actual:manifest.sources?.[file]??null,pass:/^[a-f0-9]{64}$/.test(freeze?.physics?.[file]??'')&&manifest.sources?.[file]===freeze.physics[file]}));
 const protocol=protocolFiles.map(file=>({file,expected:freeze?.protocol?.[file]??null,actual:manifest.sources?.[file]??null,pass:/^[a-f0-9]{64}$/.test(freeze?.protocol?.[file]??'')&&manifest.sources?.[file]===freeze.protocol[file]}));
 return {record,snapshot,seedRange,usedRangesRecorded,unseenSeeds,planned,physics,protocol,pass:Boolean(record&&snapshot&&unseenSeeds&&planned&&physics.every(x=>x.pass)&&protocol.every(x=>x.pass))};
}
