// Regression contract: #万物对战:8962d218. Exercise production camera/playback/event handlers;
// only WebGL/DOM sinks are replaced, so Node CI needs neither a browser nor a renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {PhotoKitchen} from '../src/photo-kitchen.js';
import {Playback} from '../src/playback.js';
import {loadCatalog,loadV3Rules,mountExtents} from '../../sim/v3.js';
const catalog=await loadCatalog(),rules=await loadV3Rules();
const parts=[['fanshuo-pot','e0','out'],['fanshuo-cushion','e180','hug']];
const sweep=Math.max(rules.core.radius,...parts.map(([id,mount,orient]) => mountExtents(catalog.find(it=>it.id===id),mount,orient,rules).r1));
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const stageSource = readFileSync(new URL('../src/stage.js', import.meta.url), 'utf8');
// Local functions are not exported by the page. Read their complete bodies, with the
// page's own indentation as the boundary; a moved/renamed function fails loudly.
const body = (source, start) => {
  const a = source.indexOf(start);
  assert(a >= 0, `Production handler missing: ${start}`);
  const b = source.indexOf('\n  }', a);
  assert(b > a, `Production handler boundary missing: ${start}`);
  return source.slice(a, b+4);
};
function rig(pvp) {
  const offsets = [], calls = [];
  const fighters = [-1,1].map(x => ({center:new THREE.Vector3(x,0,0), vel:new THREE.Vector3(), dim:0}));
  const stage = new Proxy({
    chase:false, cam:{shakeAge:Infinity, shake4:0}, fighters, jolts:true, coreRadius:rules.core.radius,
    topDown:pvp ? new THREE.Vector3(0,0,-1) : null,
    camera:new THREE.PerspectiveCamera(50,390/700,.1,100), view:{w:390,h:700,top:120},
    safeBottom:() => 120, frameRadius:() => sweep,
    setOffset:(x,y) => offsets.push([x,y]), renderer:{getPixelRatio:() => 1},
    streaks:{burst:() => {}},
    particles:{mat:{uniforms:{uScale:{value:0}}}},
    project:(point,out) => {out.x=point.x*60;out.y=point.z*60;return true;},
    fieldUniforms:{hitPoint:{value:new THREE.Vector3()}, hitAge:{value:0}, hitPower:{value:0}},
  }, {get(target,key) {return key in target ? target[key] : (...args) => calls.push([key,...args]);}});
  const methods = ['impact(point,', 'shake(px,', 'punch(point,', 'lungePunch(point,', 'shakeV4(amount)'];
  // One-line methods end on the same line rather than at the next indentation boundary.
  for (const name of methods) {
    const start = '  '+name, line = stageSource.slice(stageSource.indexOf(start)).split('\n')[0];
    const method = line.includes(' }') ? line.trim() : body(stageSource,start).trim();
    const key=name.split('(')[0], run=vm.runInNewContext('({'+method+'})', {
      THREE, tmp:new THREE.Vector3(), tmp2:new THREE.Vector3(), SHAKE_TIME:.16, PUNCH_TIME:.14,
    })[key];
    stage[key]=function(...args) {calls.push([key,...args]);return run.apply(this,args);};
  }
  const photo = Object.assign(Object.create(PhotoKitchen.prototype), {stage, enabled:false});
  stage.kitchen = {photo};
  const context = {
    THREE, stage, pvp, positionCombat:() => true, oldFx:false, tiered:true, round:true, phase:'play',
    replay:{meta:{combat:'position',winner:0}}, killer:new Map(), lastHurt:new Map(),
    overlay:new Proxy({}, {get:(_,key) => (...args) => calls.push(['overlay.'+key,...args])}),
    sfx:new Proxy({}, {get:(_,key) => (...args) => calls.push(['sfx.'+key,...args])}),
    WHITE:0xffffff,HOT:0xff8800,SPARK:0xffffff,TEAM:[0xff8800,0x0088ff],BLOCK:0xffffff,
    lungeDir:[[1,0,0],[-1,0,0]], towardPoint:() => [1,0,0],
    faces2P:side => pvp && side===1, partName:(part,item) => part==='core'?'核心':item,
    HILITE:'line',HILITE_TIME:1.8,HILITE_HOLD:1.2,hilite:null,
    buzz:() => {}, dip:() => {},flashHud:() => {},test:{highlights:0,onEvent:() => {}}, teachBlocked:() => {},wenHint:null,nudge:null,
    deflectLine:() => {throw Error('Tiered feedback must use the contact-point word');},
    lastDeflectT:-Infinity,lastKnockT:-Infinity,
  };
  const handlers = ['highlight','deflect','onEvent'].map(name => body(main,`  function ${name}(`)).join('\n');
  const onEvent = vm.runInNewContext(handlers+'\nonEvent',context);
  return {stage,photo,calls,offsets,onEvent};
}
function radius(r) {
  const {stage} = r, camera = stage.camera, k = Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const depth = new THREE.Vector3().applyMatrix4(camera.matrixWorldInverse).z;
  return -depth*k*Math.min(camera.aspect, (700-120-120)/700);
}
function trace(r) {
  const radii = [];
  // Exactly the same centres/velocities in the two modes: close, apart, close again.
  for (const distance of [.8,3.6,.8]) {
    r.stage.fighters.forEach((f,i) => f.center.set((i?1:-1)*distance/2,0,0));
    for(let n=0;n<120;n++) {r.photo.update(1/60);radii.push(radius(r));}
  }
  return Math.max(...radii)/Math.min(...radii);
}
test('2P retains single-player distance zoom, impact push-in and picture shake', () => {
  const oldDocument=globalThis.document;
  globalThis.document={getElementById:() => ({hidden:true})};
  const oldRandom=Math.random;Math.random=() => .75;
  try {
    const solo=rig(false),duel=rig(true), ratios=[trace(solo),trace(duel)];
    console.log('mode-feedback zoom ratios',JSON.stringify(ratios));
    assert(ratios[0]>1.5 && ratios[1]>1.5,'Both modes visibly change scale with distance');
    const current=[1.9826487347633357,3.105675860207148];
    const relative=(ratios[1]/ratios[0])/(current[1]/current[0]);
    assert(relative>=.85 && relative<=1.15,'The two camera projections retain their judge ratio within 15%');
    ratios.forEach((r,i) => assert(r>=current[i]*.99,'Neither mode loses its current zoom span'));
    assert(ratios[1]/ratios[0]>=.85,'2P retains at least 85% of the single-player span');
    for(const pvp of [false,true]) {
      const r=rig(pvp), control=rig(pvp);
      // Approach from the wide view: at contact, push-in has room before the fit floor.
      for(const twin of [r,control]) {
        twin.stage.fighters.forEach((f,i)=>f.center.set((i?1:-1)*1.8,0,0));
        for(let n=0;n<120;n++) twin.photo.update(1/60);
        twin.stage.fighters.forEach((f,i)=>f.center.set((i?1:-1)*.4,0,0));
        twin.photo.update(1/60);
      }
      r.onEvent({t:1,type:'hit',role:'attack',dash:true,damage:12,hpAfter:88,attacker:0,target:1,
        part:'part-0',item:'pot',targetPart:'core',point:[0,0,0]});
      const randomShake=r.stage.cam.shake4;
      r.stage.cam.shake4=0;
      r.photo.update(.04);control.photo.update(.04);
      const pushRatio=radius(r)/radius(control);
      const movement=Math.hypot(...r.offsets.at(-1).map((x,i)=>x-control.offsets.at(-1)[i]));
      console.log('mode-feedback impact',JSON.stringify({pvp,pushRatio,movement}));
      assert(pushRatio<=.9,'A landed lunge tightens the picture at least 10% beyond the same-frame no-event control');
      assert(r.stage.cam.punch?.lunge,'Lunge-direction camera punch survives');
      assert(movement>1,'A real impact moves the picture from its same-frame no-event offset');
      assert(r.calls.findIndex(c=>c[0]==='punch')>=0 && r.calls.findIndex(c=>c[0]==='punch')<r.calls.findIndex(c=>c[0]==='lungePunch'),
        'Ordinary impact punch runs before the directional lunge punch');
      assert(r.calls.some(c => c[0]==='overlay.stampLine' && c[2].verb==='冲中'),'Contact-point hit word survives');
      // The hit's random shake has its own output check; it cannot stand in for the punch above.
      Object.assign(r.stage.cam,{punch:null,push:null,shakeAge:Infinity,shakeAmp:0,shake4:randomShake});
      r.photo.update(.04);control.photo.update(.04);
      const randomMovement=Math.hypot(...r.offsets.at(-1).map((x,i)=>x-control.offsets.at(-1)[i]));
      console.log('mode-feedback random shake',JSON.stringify({pvp,randomMovement}));
      assert(randomMovement>1,'Random hit shake reaches the picture without directional punch or decisive shake');
      // Isolate the block from both the preceding hit and the separate random shake.
      Object.assign(r.stage.cam,{punch:null,push:null,shake4:0,shakeAge:Infinity,shakeAmp:0});
      r.onEvent({t:2,type:'blockResult',side:0,attacker:1,deflected:true,perfect:true,point:[0,0,0]});
      assert(r.stage.cam.shakeAmp>0 && r.stage.cam.shake4>0,'A perfect block shakes');
      r.stage.cam.punch=null;r.stage.cam.push=null;r.stage.cam.shake4=0;
      const shake=r.photo.jolt(.02,false),blockMovement=Math.hypot(...shake.slice(0,2));
      console.log('mode-feedback decisive block',JSON.stringify({pvp,blockMovement}));
      assert(blockMovement>1,'Decisive block shake reaches the picture without random shake or punch');
      assert(r.calls.some(c => c[0]==='overlay.stamp' && c[2]==='完美！'),'Perfect-block word survives');
    }
  } finally {globalThis.document=oldDocument;Math.random=oldRandom;}
});
test('the same collision segment retains its hit-stop and words in both modes, including the far seat', () => {
  const events=[{t:.1,type:'hit',role:'attack',dash:true,damage:12,hpAfter:88,attacker:0,target:1,
    part:'part-0',item:'pot',targetPart:'core',point:[0,0,0]},
    {t:.4,type:'blockResult',side:0,attacker:1,deflected:true,perfect:true,point:[0,0,0]}];
  const fighter=() => ({pos:[0,0,0],quat:[0,0,0,1],angularVelocity:[0,0,0],hp:100,maxHp:100,parts:[]});
  const replay={meta:{duration:1},decisive:{},events,frames:[0,1].map(t => ({t,fighters:[fighter(),fighter()]}))};
  const results=[];
  for(const pvp of [false,true]) {
    const creation=main.match(/pb = new Playback\(r, (\{dashOnlyImpact:[^\n]+?)\);/);assert(creation,'Live Playback constructor remains present');
    const pb=vm.runInNewContext('new Playback(r,'+creation[1]+')',{Playback,r:replay,live:{},oldFx:false,round:true,pvp,combatOptions:{combatRules:{refinedImpact:true}}});
    const r=rig(pvp);pb.slowEnabled=false;
    pb.advance(.11,1,r.onEvent);assert(Math.abs(pb.t-.1)<1e-9);assert(Math.abs(pb.hold-.07)<1e-9);
    pb.advance(.37,1,r.onEvent);assert(pb.dilate>0,'Perfect block still slows playback');
    results.push({t:pb.t,hold:pb.hold,dilate:pb.dilate,words:r.calls.filter(c => c[0].startsWith('overlay.stamp')).map(c => c[0])});
    if(pvp) {
      r.onEvent({...events[0],t:2,attacker:1,target:0});
      const word=r.calls.findLast(c => c[0]==='overlay.stampLine');
      assert.equal(word.at(-1),true,'Far-seat hit word faces the far player');
    }
  }
  assert.deepEqual(results[1],results[0]);
});
