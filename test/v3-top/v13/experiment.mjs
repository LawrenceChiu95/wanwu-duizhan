// Fixed six scenes from the accepted loadout comparison; no scene selection by v13 outcomes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const root=new URL('../../../',import.meta.url);
export const sha=x=>createHash('sha256').update(typeof x==='string'||ArrayBuffer.isView(x)?x:JSON.stringify(x)).digest('hex');
export const median=xs=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;};
export const foe={parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'lamp-lux3d',mount:'e180',orient:'hug'}]};
export const fixtures=[['pan-broom',['pan-lux3d','broom']],['scissors-pillow',['scissors','pillow']],['lamp-slipper',['lamp-lux3d','slipper']]].flatMap(([id,items])=>[
 {id:`${id}/out-out-e180`,definition:{parts:items.map((item,i)=>({item,mount:i?'e180':'e0',orient:'out'}))}},
 {id:`${id}/hug-hug-e90`,definition:{parts:items.map((item,i)=>({item,mount:i?'e90':'e0',orient:'hug'}))}}
]);
export const mash=[];
for(let step=60;step<7200;step+=552)mash.push({step,side:0,action:'dash'});
for(let step=300;step<7200;step+=624)mash.push({step,side:0,action:'block'});
mash.sort((a,b)=>a.step-b.step);
export const options=(f,seed,condition='timing',blockTime=.25,mode='A')=>({fighters:[f.definition,foe],mode,seed,
 manual:condition==='auto'?null:{sides:condition==='timing'?['ai','ai']:['input','ai'],inputs:condition==='mash'?mash:[],blockTime}});
export async function baseline(){
 const show=file=>execFileSync('git',['show',`bbaaeb7:${file}`],{cwd:root,encoding:'utf8',maxBuffer:1000000});
 let source=show('sim/v3.js');const rules=show('sim/v3-rules.json');
 for(const file of ['index.js','math.js'])assert.equal(sha(await readFile(new URL(`sim/${file}`,root))),sha(show(`sim/${file}`)),`baseline ${file}`);
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
 const from="new URL('./v3-rules.json',import.meta.url)";assert.equal(source.split(from).length,2);
 source=source.replace(from,`new URL('data:application/json;base64,${Buffer.from(rules).toString('base64')}')`);
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
