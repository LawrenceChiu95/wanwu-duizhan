import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {simulateV3,createV3Match,loadCatalog,loadV3Rules,tierDamage,timeoutVerdict} from '../../sim/v3.js';
import {loadRules} from '../../sim/index.js';
import {simulateWithRules} from '../v3-top/variant.mjs';
const bare={parts:[]},rules=await loadV3Rules(),catalog=await loadRules();

test('physical fence bounces an outward core without creating fighter hits or HP loss',async()=>{
 const simulate=await simulateWithRules({maxDuration:2,initialGap:3.2,attraction:-10,thrust:0,speedLimit:8,top:{spinRate:0}});
 const r=await simulate({fighters:[bare,bare],mode:'A',seed:1,manual:{sides:['input','input'],inputs:[{step:1,side:0,action:'block'}]}});
 const wall=rules.arenaRadius-rules.core.radius;
 assert.ok(r.frames.some(fr=>fr.fighters.some(f=>Math.abs(f.pos[0])>wall-.1)),'reaches the wall');
 assert.ok(r.frames.some(fr=>fr.fighters.some(f=>Math.abs(f.pos[0])>wall-.25&&f.pos[0]*f.velocity[0]<-.1)),'solver reverses outward velocity');
 for(const fr of r.frames)for(const f of fr.fighters){assert.ok(Math.hypot(f.pos[0],f.pos[2])+rules.core.radius<rules.arenaRadius+.012);assert.equal(f.core.hp,160);}
 assert.ok(!r.events.some(e=>['contact','hit','weak','parry','break'].includes(e.type)));assert.ok(r.events.filter(e=>e.type==='blockResult').every(e=>e.outcome==='empty'));
});

test('category stats agree for original and generated assets, while mounting keeps per-item outward ends',async()=>{
 const items=await loadCatalog(),m=await createV3Match({fighters:[{parts:[{item:'scissors',mount:'e0',orient:'out'}]},{parts:[{item:'wasteland-knife',mount:'e0',orient:'out'}]}],seed:0});
 try{assert.equal(m.initial[0].parts[0].maxHp,m.initial[1].parts[0].maxHp);assert.equal(m.initial[0].parts[0].maxHp,84);}finally{m.free();}
 const args={mode:'B',impulse:3,target:items.find(i=>i.id==='pillow'),materials:catalog.materials,matchups:catalog.matchups,maxHp:10000,rules};
 assert.equal(tierDamage({...args,attacker:items.find(i=>i.id==='scissors')}).damage,tierDamage({...args,attacker:items.find(i=>i.id==='wasteland-knife')}).damage);
 assert.equal(rules.top.outEnd.broom,-1);assert.equal(rules.top.outEnd['pan-lux3d'],-1);
});

test('out trades protection for damage, hug trades damage for protection, before existing hit caps',()=>{
 const item=catalog.items.find(i=>i.id==='pot'),args={mode:'A',impulse:1,attacker:item,target:item,materials:catalog.materials,matchups:catalog.matchups,maxHp:1000,rules};
 const base=tierDamage(args).damage,out=tierDamage({...args,attackerOrient:'out'}),hug=tierDamage({...args,attackerOrient:'hug'});
 assert.ok(out.damage>base&&hug.damage<base);
 assert.ok(tierDamage({...args,targetOrient:'out'}).damage>base);assert.ok(tierDamage({...args,targetOrient:'hug'}).damage<base);
 for(const weak of [false,true]){const d=tierDamage({...args,impulse:1000,maxHp:10,attackerOrient:'out',targetOrient:'out',weak});assert.equal(d.damage,10*(weak?.4:.3));}
});

test('timeout compares ratios, then live-part HP, ignores dead parts, and never breaks a complete tie by side',()=>{
 const fighter=(hp,maxHp,parts=[])=>({core:{hp,maxHp},parts});
 const part=(hp,alive=true)=>({hp,alive});
 let v=timeoutVerdict([fighter(50,100,[part(999)]),fighter(60,100)]);assert.equal(v.winner,1);assert.equal(v.why.criterion,'core-hp-ratio');
 v=timeoutVerdict([fighter(50,100,[part(5),part(999,false)]),fighter(100,200,[part(6)])]);assert.equal(v.winner,1);assert.deepEqual(v.why.partHp,[5,6]);assert.equal(v.why.criterion,'part-hp');
 v=timeoutVerdict([fighter(50,100,[part(5)]),fighter(100,200,[part(5)])]);assert.equal(v.winner,null);assert.equal(v.why.criterion,'draw');
});

test('terminal result follows final guard resolution/frame and carries timeout facts even with no impacts',async()=>{
 const simulate=await simulateWithRules({maxDuration:.1,initialGap:3,attraction:0,thrust:0,top:{spinRate:0}});
 const r=await simulate({fighters:[bare,bare],seed:0,manual:{sides:['input','input'],inputs:[{step:1,side:0,action:'block'}]}});
 assert.deepEqual(r.events[0],{t:0,type:'start'});assert.equal(r.events.filter(e=>e.type==='start').length,1);
 assert.equal(r.events.at(-2).type,'blockResult');assert.equal(r.events.at(-1).type,'result');assert.equal(r.events.filter(e=>e.type==='result').length,1);
 assert.equal(r.frames.at(-1).t,r.events.at(-1).t);assert.equal(r.meta.reason,'timeout');assert.equal(r.meta.winner,null);assert.equal(r.decisive.eventIndex,null);assert.equal(r.decisive.why.criterion,'draw');
 assert.deepEqual(r.events.at(-1),{t:r.meta.duration,type:'result',winner:null,reason:'timeout',why:r.decisive.why});
});

test('a full 60-second real-contact match awards timeout by final core ratios and emits consistent terminal facts',async()=>{
 // Higher core HP keeps both cores alive through the real 60-second match; no HP/event injection.
 const simulate=await simulateWithRules({core:{hp:10000}});
 const r=await simulate({fighters:[{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'broom',mount:'e180',orient:'out'}]},{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'lamp-lux3d',mount:'e180',orient:'hug'}]}],mode:'A',seed:0,manual:{sides:['ai','ai']}});
 const final=r.frames.at(-1),ratios=final.fighters.map(f=>f.core.hp/f.core.maxHp),winner=ratios[0]>ratios[1]?0:1;
 assert.equal(r.meta.duration,60);assert.equal(final.t,60);assert.equal(r.meta.reason,'timeout');
 assert.ok(ratios.every(x=>x>0&&x<1));assert.notEqual(ratios[0],ratios[1]);assert.equal(r.meta.winner,winner);
 assert.ok(r.events.some(e=>e.damage>0));assert.ok(!r.events.some(e=>e.type==='ko'));
 assert.equal(r.decisive.why.kind,'timeout');assert.equal(r.decisive.why.criterion,'core-hp-ratio');assert.deepEqual(r.decisive.why.coreRatios,ratios);
 assert.deepEqual(r.decisive.why.partHp,final.fighters.map(f=>f.parts.reduce((sum,p)=>sum+(p.alive?Math.max(0,p.hp):0),0)));
 assert.equal(r.decisive.eventIndex,null);assert.equal(r.decisive.finishType,'timeout');
 assert.equal(r.decisive.caption,`时间到，${winner===0?'左':'右'}方核心剩血比例更多`);
 assert.equal(r.events.filter(e=>e.type==='result').length,1);assert.deepEqual(r.events.at(-1),{t:60,type:'result',winner,reason:'timeout',why:r.decisive.why});
 const json=JSON.stringify(r),sha256=createHash('sha256').update(json).digest('hex');
 await writeFile(new URL('./timeout-replay.json.gz',import.meta.url),gzipSync(json));
 await writeFile(new URL('./timeout-proof.json',import.meta.url),JSON.stringify({fixture:'real contacts for 60 seconds; core HP override 10000 only',seed:0,mode:'A',duration:60,winner,why:r.decisive.why,caption:r.decisive.caption,damageEvents:r.events.filter(e=>e.damage>0).length,finalCoreHp:final.fighters.map(f=>f.core.hp),eventIndex:r.decisive.eventIndex,replaySha256:sha256},null,2)+'\n');
});

test('ready fires once at each used cooldown boundary before accepting the same-step press; replay stays identical',async()=>{
 const simulate=await simulateWithRules({maxDuration:11,initialGap:3,attraction:0,thrust:0,top:{spinRate:0}});
 const options={fighters:[bare,bare],seed:9,manual:{sides:['input','input'],inputs:[{step:1,side:0,action:'block'},{step:601,side:0,action:'block'}]}};
 const r=await simulate(options),ready=r.events.filter(e=>e.type==='ready');
 assert.deepEqual(ready.map(e=>[e.side,e.action,e.t]),[[0,'block',601*rules.dt],[0,'block',1201*rules.dt]]);
 assert.ok(r.events.indexOf(ready[0])<r.events.findIndex(e=>e.type==='press'&&e.t===ready[0].t));
 assert.equal(JSON.stringify(r),JSON.stringify(await simulate(options)));
});
