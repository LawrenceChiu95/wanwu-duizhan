// Elara c65e070d: verify contact feedback changes while physics, damage, random consumption and inputs do not.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {simulateV3} from '../../../sim/v3.js';
import {simulateWithRules} from '../variant.mjs';
import {root,fixtures,options,sha} from './experiment.mjs';
async function before(overrides={}){
 let source=execFileSync('git',['show','622fdd0:sim/v3.js'],{cwd:root,encoding:'utf8'});
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
 source=source.replace("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
 const point='const c=await loadCatalogRules(),r=await loadV3Rules();';assert.equal(source.split(point).length,2);
 const merge='const merge=(a,b)=>{for(const[k,v]of Object.entries(b))if(v&&typeof v==="object"&&!Array.isArray(v)&&a[k]&&typeof a[k]==="object")merge(a[k],v);else a[k]=v;return a;};';
 source=source.replace(point,point+merge+`merge(r,${JSON.stringify(overrides)});`);
 return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).simulateV3;
}
const rules={maxDuration:1.3,top:{spinRate:0}},old=await before(),controlledOld=await before(rules),controlledNew=await simulateWithRules(rules);
const cases=[{id:'cold-new-contact',old:controlledOld,now:controlledNew,options:{fighters:[{parts:[]},{parts:[]}],seed:3,manual:{sides:['input','input'],blockTime:.25,inputs:[{step:125,side:0,action:'block'}]}}},
 {id:'formal-timing-7',old,now:simulateV3,options:options(fixtures[0],7,'timing')},
 {id:'formal-mash-42',old,now:simulateV3,options:options(fixtures[3],42,'mash')}];
const rows=[];
for(const c of cases){
 const a=await c.old(c.options),b=await c.now(c.options),without=r=>({...r,events:r.events.filter(e=>e.type!=='blockResult')});
 assert.equal(JSON.stringify(without(a)),JSON.stringify(without(b)),`${c.id}: change beyond blockResult`);
 const was=a.events.filter(e=>e.type==='blockResult'),now=b.events.filter(e=>e.type==='blockResult');
 if(c.id==='cold-new-contact'){assert.equal(was[0].outcome,'empty');assert.equal(now[0].outcome,'perfect');assert.equal(now[0].damageApplied,false);}
 rows.push({id:c.id,inputs:c.options.manual,framesSha256:sha(a.frames),afterFramesSha256:sha(b.frames),nonFeedbackReplaySha256:sha(without(a)),afterNonFeedbackReplaySha256:sha(without(b)),equalOutsideBlockFeedback:true,beforeResults:was,afterResults:now});
}
const proof={beforeCommit:'622fdd0',afterSourceSha256:sha(await readFile(new URL('sim/v3.js',root))),rulesSha256:sha(await readFile(new URL('sim/v3-rules.json',root))),cases:rows};
await writeFile(new URL('review-r1-proof.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(rows.map(({id,equalOutsideBlockFeedback})=>({id,equalOutsideBlockFeedback}))));
