import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {simulateV3,createV3Match} from '../../sim/v3.js';
const foes=JSON.parse(await fs.readFile(new URL('../../data/foes.json',import.meta.url))).foes;
const build=b=>({parts:b.parts.map((p,i)=>({...p,mount:i?b.spread:'e0'}))});
const player={parts:[{item:'pan-lux3d',orient:'out',mount:'e0'},{item:'pillow',orient:'hug',mount:'e180'}]};
const foe={parts:[{item:'broom',orient:'out',mount:'e0'},{item:'pan-lux3d',orient:'hug',mount:'e90'}]};
const digest=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
const mash=[];
for(let step=60;step<7200;step+=552)mash.push({step,side:0,action:'dash'});
for(let step=300;step<7200;step+=624)mash.push({step,side:0,action:'block'});
mash.sort((a,b)=>a.step-b.step);
test('absent and null profiles retain full pre-change replay bytes',async()=>{
 const expected={7:'c6b1e830ff9d4465795017c46cab4ec75a83f06857dd684b2676e3bcccc6bf59',42:'b3aca2a9582b7b4dbe1397db4b4b5dc39e3c46db4af2b94cd54037c5582f23c9',99:'fb02c6d3dfbef5c332cd857a6c1c4ea27fea55673e914a877348bf61e60a0817'};
 for(const [seed,hash]of Object.entries(expected))for(const aiProfiles of [undefined,[null,null]]){
  const r=await simulateV3({fighters:[player,foe],seed:+seed,manual:{sides:['ai','ai'],...(aiProfiles&&{aiProfiles})}});
  assert.equal(digest(r),hash);assert.equal(Object.hasOwn(r.meta.manual,'aiProfiles'),false);
 }
});
for(const f of foes)test(f.id+' freezes profile and resimulates identical full replay',async()=>{
 const profile=structuredClone(f.ai),options={fighters:[player,build(f.build)],seed:860001,manual:{sides:['input','ai'],aiSeeds:[1201,1202],aiProfiles:[null,profile],inputs:mash}};
 const match=await createV3Match(options);profile.think=1.5;profile.dashRange[1]=9;
 while(!match.done)match.advance();const r=match.result();assert.deepEqual(r.meta.manual.aiProfiles,[null,f.ai]);
 const replay=await simulateV3({...options,manual:r.meta.manual});assert.equal(digest(replay),digest(r));
 for(const e of r.events.filter(e=>e.type==='press'&&e.side===1))assert(e.reactionSteps>=Math.round(f.ai.reactionDelay*120));
 if(f.id==='mang')assert.equal(r.events.filter(e=>e.type==='block'&&e.side===1).length,0);
});
test('reject invalid profile contract before creating a physics world',async()=>{
 const p=foes[0].ai,invalid=[[],[null],[null,null,null],[null,{}],[null,{...p,id:'code'}],[null,{...p,version:2}],[null,{...p,think:0}],[null,{...p,reactionDelay:NaN}],[null,{...p,reactionJitter:-1}],[null,{...p,blockLead:Infinity}],[null,{...p,dashRange:[3,1]}],[null,{...p,dashRange:[0,11]}],new Array(2)];
 for(const aiProfiles of invalid)await assert.rejects(createV3Match({fighters:[player,foe],seed:1,manual:{sides:['ai','ai'],aiProfiles}}));
 for(const idleDashAfter of [undefined,0,61,NaN])await assert.rejects(createV3Match({fighters:[player,foe],seed:1,manual:{sides:['ai','ai'],aiProfiles:[null,{...foes[1].ai,idleDashAfter}]}}));
 await assert.rejects(createV3Match({fighters:[player,foe],seed:1,manual:{sides:['input','ai'],aiProfiles:[p,null]}}));
});
test('mirrored seats keep the explicit AI seed and profile with their role',async()=>{
 const f=foes[2],seeds=[903,904];
 for(const mirror of [false,true]){
  const r=await simulateV3({fighters:mirror?[build(f.build),player]:[player,build(f.build)],seed:860002,manual:{sides:['ai','ai'],aiSeeds:mirror?[...seeds].reverse():seeds,aiProfiles:mirror?[f.ai,null]:[null,f.ai]}});
  assert.equal(r.meta.manual.aiSeeds[mirror?0:1],904);assert.equal(r.meta.manual.aiProfiles[mirror?0:1].id,'chang');assert.equal(r.meta.manual.aiProfiles[mirror?1:0],null);
 }
});
test('every actual wen dash follows a counter window or eight-second idle rule, including delayed decisions',async()=>{
 const f=foes[1];let accepted=0;
 for(const delay of [f.ai.reactionDelay,2])for(const seed of [860000,860001,860002,860003]){
  const r=await simulateV3({fighters:[player,build(f.build)],seed,manual:{sides:['input','ai'],inputs:mash,aiProfiles:[null,{...f.ai,reactionDelay:delay}]}});
  for(const [index,e]of r.events.entries())if(e.type==='press'&&e.side===1&&e.action==='dash'){
   accepted++;const visible=r.events.slice(0,index).filter(x=>x.t<e.t);
   const lastDash=visible.findLast(x=>x.type==='press'&&x.side===1&&x.action==='dash')?.t??0;
   assert(visible.some(x=>x.type==='blockResult'&&x.side===1&&x.outcome==='perfect'&&e.t<=x.t+.8||x.type==='dash'&&x.phase==='end'&&x.side===0&&e.t<=x.t+2.4)||e.t-lastDash>=f.ai.idleDashAfter-1e-8,JSON.stringify({seed,delay,t:e.t}));
  }
 }
 assert(accepted>0,'Fixture must exercise accepted counter attacks');
});
test('wen eventually chooses an ordinary dash against a player who never presses',async()=>{
 const f=foes[1];let idle=0;
 for(const seed of [860000,860001,860002,860003]){
  const r=await simulateV3({fighters:[player,build(f.build)],seed,manual:{sides:['input','ai'],aiProfiles:[null,f.ai]}});
  let until=-Infinity,lastDash=0;
  for(const e of r.events){
   if(e.type==='blockResult'&&e.side===1&&e.outcome==='perfect')until=e.t+.8;
   if(e.type==='press'&&e.side===1&&e.action==='dash'){
    if(e.t>until){assert(e.t-lastDash>=f.ai.idleDashAfter-1e-8);idle++;}lastDash=e.t;
   }
  }
 }
 assert(idle>0,'Fixture must exercise the idle exception without a player dash');
});
