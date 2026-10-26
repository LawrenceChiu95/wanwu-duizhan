import RAPIER from '@dimforge/rapier3d-compat';
import {add,sub,scale,length,vec,arr,quat,qarr,euler,rotate,inverseRotate,random} from './math.js';
let initialized;
const ready=()=>initialized??=(RAPIER.init());
let catalogPromise;
async function readCatalog(){
 const url=new URL('../data/catalog.json',import.meta.url);
 if(url.protocol==='file:') {const fs=await import('node:fs/promises');return JSON.parse(await fs.readFile(url,'utf8'));}
 const response=await fetch(url);if(!response.ok)throw Error(`Catalog HTTP ${response.status}`);return response.json();
}
/** Catalog entries. GLBs are already centered, in meters; scale=1. */
export async function loadCatalog(){const c=await (catalogPromise??=readCatalog());return structuredClone(c.items);}
export async function loadRules(){const c=await (catalogPromise??=readCatalog());return structuredClone(c);}
export function zoneRadius(t,a){return a.zoneStartRadius+(a.zoneEndRadius-a.zoneStartRadius)*Math.max(0,Math.min(1,(t-a.zoneShrinkStart)/(a.zoneShrinkEnd-a.zoneShrinkStart)));}
export function contactDamage({mode,impulse,attacker,target,materials,matchups,weak}){
 const hardness=Math.sqrt(materials[attacker.material].hardness/materials[target.material].hardness);
 const matchup=matchups[attacker.tag]?.[target.tag]??1;
 const base=mode==='A'?impulse*hardness:Math.max(0,attacker.stats.attack*matchup-target.stats.defense);
 return {base,hardness,matchup,multiplier:weak?2:1,damage:base*(weak?2:1)};
}
function validate(def,c){
 if(!def||!Array.isArray(def.parts)||![1,3].includes(def.parts.length))throw Error('A fighter needs one core item or three mounted items');
 const seen=new Set();
 for(const p of def.parts){if(!c.items.some(i=>i.id===p.item))throw Error(`Unknown item ${p.item}`);if(!c.arena.mounts[p.mount])throw Error(`Unknown mount ${p.mount}`);if(seen.has(p.mount))throw Error('Mounts must be unique');seen.add(p.mount);if(!Array.isArray(p.rot)||p.rot.length!==3||!p.rot.every(Number.isFinite))throw Error('rot must contain three finite radians');}
 if(def.parts.length===1&&def.parts[0].mount!=='core')throw Error('Single item must use core');
 if(def.parts.length===3&&seen.has('core'))throw Error('Assemblies use front, top and side');
}
function createFighter(world,def,index,rng,c){
 const a=c.arena;
 const start=[index===0?-1.25:1.25,(rng()-.5)*.24,(rng()-.5)*.24];
 const rotation=euler([(rng()-.5)*.3,index===0?Math.PI/2:-Math.PI/2,(rng()-.5)*.3]);
 const spin=[rng()-.5,rng()-.5,rng()-.5];
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...start).setRotation(quat(rotation)).setCcdEnabled(true).setCanSleep(false).setLinearDamping(a.linearDamping).setAngularDamping(a.angularDamping).setAngvel(vec(scale(spin,1.2))));
 if(def.parts.length>1)world.createCollider(RAPIER.ColliderDesc.cuboid(...a.base.halfExtents).setDensity(a.base.density).setRestitution(.7),body);
 const parts=def.parts.map(p=>{
  const item=c.items.find(i=>i.id===p.item),offset=a.mounts[p.mount],rotation=euler(p.rot),mat=c.materials[item.material];
  const d=RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));if(!d)throw Error(`Invalid hull ${p.item}`);
  const collider=world.createCollider(d.setDensity(mat.density).setTranslation(...offset).setRotation(quat(rotation)).setRestitution(mat.restitution).setFriction(.12),body);
  return {item,collider,mount:p.mount,rot:p.rot};
 });
 body.recomputeMassPropertiesFromColliders();
 const maxHp=parts.reduce((s,p)=>s+p.item.stats.hp,0);
 return {body,parts,maxHp,hp:maxHp,spin,definition:structuredClone(def),start,rotation,mass:body.mass(),com:arr(body.localCom())};
}
function partFrame(p){return {item:p.item.id,mount:p.mount,pos:arr(p.collider.translation()),quat:qarr(p.collider.rotation())};}
function fighterFrame(f){return {pos:arr(f.body.translation()),quat:qarr(f.body.rotation()),hp:Math.max(0,f.hp),maxHp:f.maxHp,parts:f.parts.map(partFrame)};}
function weakContact(part,point){const local=inverseRotate(qarr(part.collider.rotation()),sub(point,arr(part.collider.translation())));return length(sub(local,part.item.weakPoint.pos))<=part.item.weakPoint.radius;}
function captionFor(e,c){
 if(e.type==='zone')return '留在缩小的安全球外，持续失血。';
 if(e.type==='ringout')return '被撞出了外层球壳，出界落败。';
 if(e.type==='ko')return '血量耗尽，无法继续对撞。';
 const a=c.items.find(i=>i.id===e.item),b=c.items.find(i=>i.id===e.targetItem);
 const mount=e.mount==='core'?'':`${{front:'前',top:'上',side:'侧'}[e.mount]}装的`;
 const cause=e.weak?'撞中了弱点，伤害翻倍':e.mode==='A'?`撞击冲量 ${e.impulse.toFixed(1)}，硬度修正 ${e.hardness.toFixed(2)}`:e.matchup>1?'材质克制，攻击放大了 1.5 倍':'接触后按攻击和防御扣血';
 return `${mount}${a.name}撞到${b.name}：${cause}，扣掉 ${e.damage.toFixed(1)} 点血。`;
}
/** Simulate once, then play frames. No wall clock, Math.random or rendering state. */
export async function simulate({fighters:definitions,mode,seed}){
 if(mode!=='A'&&mode!=='B')throw Error('mode must be A or B');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');
 if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 const c=await loadRules();definitions.forEach(d=>validate(d,c));await ready();
 const a=c.arena,world=new RAPIER.World({x:0,y:0,z:0});world.timestep=a.dt;
 try{
 const rng=random(seed),fighters=definitions.map((d,i)=>createFighter(world,d,i,rng,c));
 const initial=fighters.map(f=>({definition:f.definition,pos:f.start,quat:f.rotation,mass:f.mass,centerOfMass:f.com,maxHp:f.maxHp}));
 const frames=[],events=[],contacts=new Map();let t=0,winner=null,reason='timeout',maxPenetration=0,contactFrames=0,longestContact=0,streak=0;
 const record=()=>frames.push({t,fighters:fighters.map(fighterFrame),zoneRadius:zoneRadius(t,a)});
 record();
 function emit(e){e.caption=captionFor(e,c);events.push(e);}
 for(let step=1;step<=Math.round(a.maxDuration/a.dt);step++){
  t=step*a.dt;
  // Pulsed pursuit leaves time for physical recoil; attraction is always much weaker.
  fighters.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),target=arr(fighters[1-i].body.worldCom()),delta=sub(target,p),dist=length(delta);
   const pulse=t-(f.lastImpact??-Infinity)<.6?0:((t%2.4)<1.15?1:.12);
   const acceleration=add(scale(p,-a.attraction),scale(delta,dist>1e-6?a.thrust*pulse/dist:0));
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);
   const v=arr(f.body.linvel()),speed=length(v);if(speed>a.speedLimit)f.body.setLinvel(vec(scale(v,a.speedLimit/speed)),true);
  });
  world.step();
  let touching=false;
  for(let pi=0;pi<fighters[0].parts.length;pi++)for(let pj=0;pj<fighters[1].parts.length;pj++){
   const left=fighters[0].parts[pi],right=fighters[1].parts[pj],key=`${pi}:${pj}`;
   let impulse=0,bestImpulse=-1,point=null,penetration=0;
   world.contactPair(left.collider,right.collider,(m,flipped)=>{
    for(let k=0;k<m.numContacts();k++){
     if(m.contactDist(k)>.002)continue;
     penetration=Math.max(penetration,-m.contactDist(k));const j=m.contactImpulse(k);impulse+=j;
     if(j>bestImpulse){bestImpulse=j;const v=flipped?m.localContactPoint2(k):m.localContactPoint1(k);if(v)point=add(arr(left.collider.translation()),rotate(qarr(left.collider.rotation()),arr(v)));}
    }
   });
   maxPenetration=Math.max(maxPenetration,penetration);
   if(point){touching=true;}
   // One damaging impact per contact episode, not one B hit per physics frame.
   const prior=contacts.get(key);
   if(point&&impulse>.0001&&(!prior||!Number.isFinite(prior.lastHit)||t-prior.lastSeen>.10)&&(!prior||t-prior.lastHit>=a.contactCooldown)){
    for(const [attacker,target,attPart,tgtPart] of [[0,1,left,right],[1,0,right,left]]){
     const weak=weakContact(tgtPart,point),d=contactDamage({mode,impulse:impulse*a.impulseToDamage,attacker:attPart.item,target:tgtPart.item,materials:c.materials,matchups:c.matchups,weak});
     const e={t,type:weak?'weak':d.damage>=20?'crit':'hit',attacker,target,point,item:attPart.item.id,targetItem:tgtPart.item.id,mount:attPart.mount,targetMount:tgtPart.mount,mode,impulse,hardness:d.hardness,matchup:d.matchup,weak,multiplier:d.multiplier,damage:d.damage};
     fighters[target].hp-=d.damage;emit(e);
    }
    // Explicit game recoil, stronger than the continuous center attraction.
    const delta=sub(arr(fighters[1].body.worldCom()),arr(fighters[0].body.worldCom()));
    const n=scale(delta,1/Math.max(length(delta),1e-6));
    fighters.forEach((f,i)=>{f.body.applyImpulse(vec(scale(n,(i===0?-1:1)*f.mass*a.recoilSpeed)),true);f.lastImpact=t;});
    contacts.set(key,{lastHit:t,lastSeen:t});
   } else if(point)contacts.set(key,{lastHit:prior?.lastHit??-Infinity,lastSeen:t});
  }
  if(touching){streak+=a.dt;contactFrames++;longestContact=Math.max(longestContact,streak);}else streak=0;
  const fallen=[];
  fighters.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),r=length(p);
   if(r>a.radius){emit({t,type:'ringout',attacker:1-i,target:i,point:p,item:null,damage:0});fallen.push([i,'ringout']);}
   // Zone damage integrated every fixed step; events grouped at 0.5 s for readable playback.
   if(r>zoneRadius(t,a)){
    const damage=a.zoneDamagePerSecond*a.dt;f.hp-=damage;f.zonePending=(f.zonePending??0)+damage;
   }
   if((step%30===0||f.hp<=0||r>a.radius)&&f.zonePending>0){emit({t,type:'zone',attacker:null,target:i,point:p,item:null,damage:f.zonePending});f.zonePending=0;}
   if(f.hp<=0&&!fallen.some(([j])=>j===i)){emit({t,type:'ko',attacker:1-i,target:i,point:p,item:null,damage:0});fallen.push([i,'ko']);}
  });
  if(step%2===0||fallen.length)record();
  if(fallen.length){winner=fallen.length===2?null:1-fallen[0][0];reason=fallen.length===2?'double-ko':fallen[0][1];break;}
 }
 fighters.forEach((f,i)=>{if(f.zonePending>0){emit({t,type:'zone',attacker:null,target:i,point:arr(f.body.worldCom()),item:null,damage:f.zonePending});f.zonePending=0;}});
 if(frames.at(-1).t!==t)record();
 const decisiveEvent=events.findLast(e=>['ko','ringout'].includes(e.type))??events.filter(e=>e.type==='weak'||e.type==='crit').sort((x,y)=>y.damage-x.damage)[0]??events.filter(e=>e.type==='hit').sort((x,y)=>y.damage-x.damage)[0];
 // For KO, show the actual last damaging cause, not a fabricated range/weakness story.
 let cause=decisiveEvent;
 if(cause?.type==='ko')cause=events.findLast(e=>e.target===cause.target&&e.damage>0)??cause;
 const at=cause?.t??t;
 const t0=Math.max(0,Math.min(t-2.5,at-1.5)),t1=Math.min(t,t0+2.5);
 const decisive={t0,t1,caption:cause?.caption??'时间到了，双方都还站着，本局平局。',eventIndex:cause?events.indexOf(cause):null};
 return {meta:{seed,mode,duration:t,winner,reason,initial,arenaRadius:a.radius,engine:'rapier3d-compat@0.21.0',schemaVersion:1,diagnostics:{maxPenetration,contactFrames,longestContact}},frames,events,decisive};
 }finally{world.free();}
}
