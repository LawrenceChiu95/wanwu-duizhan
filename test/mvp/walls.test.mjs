import test from 'node:test';
import assert from 'node:assert/strict';
import {measureWalls} from './walls.mjs';
import {loadCatalog} from '../../sim/v3.js';
import {simulateWithRules} from '../v3-top/variant.mjs';

test('wall measurement uses transformed live hull vertices and polygon planes, not a radial bounding circle',()=>{
 const item={id:'fixture',hull:[[.1,0,0],[-.1,0,0]]},part={item:'fixture',alive:true,pos:[2.15,0,0],quat:[0,0,Math.SQRT1_2,Math.SQRT1_2]};
 const replay={meta:{rules:{arenaRadius:2.2,frameStride:4,dt:1/120}},frames:[{fighters:[{parts:[part,{...part,alive:false,pos:[20,0,0]}]}]}]};
 let m=measureWalls(replay,[item]);assert.equal(m.liveVertices,2);assert.ok(Math.abs(m.maxPartSupport-2.15)<1e-12);assert.equal(m.maxPartExcess,0);
 part.quat=[0,0,0,1];m=measureWalls(replay,[item]);assert.ok(Math.abs(m.maxPartExcess-.05)<1e-12);
 // Halfway between wall normals the circumscribed polygon includes points outside its incircle.
 part.pos=[2.201*Math.cos(Math.PI/64),0,2.201*Math.sin(Math.PI/64)];item.hull=[[0,0,0]];
 assert.equal(measureWalls(replay,[item]).maxPartExcess,0);
 assert.throws(()=>measureWalls(replay,[]),/Missing hull/);
});

test('an outward long attachment actually reaches a wall; its live hull is measured at every physics step',async()=>{
 const simulate=await simulateWithRules({maxDuration:2,frameStride:1,initialGap:.5,attraction:-10,thrust:0,speedLimit:4,top:{spinRate:0}});
 const r=await simulate({fighters:[{parts:[{item:'broom',mount:'e180',orient:'out'}]},{parts:[]}],seed:1});
 const m=measureWalls(r,await loadCatalog());
 assert.ok(m.liveVertices>0);assert.equal(m.frameStride,1);assert.ok(m.maxPartSupport>r.meta.rules.arenaRadius-.02,'a live long hull must touch the wall');
 assert.ok(m.maxPartExcess<.03,`sampled wall excess ${m.maxPartExcess} m`);
 assert.ok(!r.events.some(e=>e.damage>0||e.type==='contact'));
});
