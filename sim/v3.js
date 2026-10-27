import RAPIER from '@dimforge/rapier3d-compat';
import {loadRules as loadCatalogRules, strikeRoles, weakCritical} from './index.js';
import {add,sub,scale,length,vec,arr,quat,qarr,euler,rotate,inverseRotate,random} from './math.js';
let initialized, rulesPromise;
const ready=()=>initialized??=RAPIER.init();
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const ANCHORS=Object.freeze(Object.fromEntries(Object.entries({front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0]}).map(([k,v])=>[k,Object.freeze(v)])));
export async function loadV3Rules(){
 rulesPromise??=(async()=>{const url=new URL('./v3-rules.json',import.meta.url);if(url.protocol==='file:'){const fs=await import('node:fs/promises');return JSON.parse(await fs.readFile(url,'utf8'));}const r=await fetch(url);if(!r.ok)throw Error(`v3 rules HTTP ${r.status}`);return r.json();})();
 return structuredClone(await rulesPromise);
}
export {loadCatalog} from './index.js';
function validate(def,c){
 if(!def||!Array.isArray(def.parts)||def.parts.length>2)throw Error('v3 requires a core sphere with zero, one or two attachments');
 const used=new Set(),items=new Set();
 for(const p of def.parts){if(!c.items.some(i=>i.id===p.item))throw Error(`Unknown item ${p.item}`);if(items.has(p.item))throw Error('Duplicate attachments are outside this prototype');items.add(p.item);if(!Object.hasOwn(ANCHORS,p.mount)||used.has(p.mount))throw Error('Each attachment needs a unique one of six anchors');used.add(p.mount);if(!Array.isArray(p.rot)||p.rot.length!==3||!p.rot.every(Number.isFinite))throw Error('rot must contain three finite radians');}
}
/** Place the rotated inward face just outside the core. No non-uniform scale. */
export function attachmentOffset(item,mount,rot,r){
 const direction=ANCHORS[mount],q=euler(rot),nearest=Math.min(...item.hull.map(v=>dot(rotate(q,v),direction)));
 return scale(direction,r.core.radius+r.anchorGap-nearest);
}
const bodyPointVelocity=(body,point)=>add(arr(body.linvel()),cross(arr(body.angvel()),sub(point,arr(body.worldCom()))));
function partFrame(p){return {id:p.id,item:p.item.id==='__core'?null:p.item.id,mount:p.mount,pos:p.alive?arr(p.collider.translation()):p.brokenPose.pos,quat:p.alive?qarr(p.collider.rotation()):p.brokenPose.quat,hp:p.hp,maxHp:p.maxHp,alive:p.mount==='core'?p.hp>0:p.alive};}
function fighterFrame(f){return {pos:arr(f.body.translation()),quat:qarr(f.body.rotation()),hp:f.core.hp,maxHp:f.core.maxHp,core:partFrame(f.core),parts:f.parts.map(partFrame),velocity:arr(f.body.linvel()),angularVelocity:arr(f.body.angvel()),mass:f.mass,centerOfMass:arr(f.body.worldCom())};}
function buildFighter(world,def,index,rng,c,r){
 const spin=Array.from({length:3},()=>rng()-.5),unit=scale(spin,1/length(spin));
 const rotation=euler([(rng()-.5)*.3,index===0?Math.PI/2:-Math.PI/2,(rng()-.5)*.3]);
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(quat(rotation)).setCcdEnabled(true).setCanSleep(false).setLinearDamping(r.linearDamping).setAngularDamping(r.angularDamping).setAngvel(vec(scale(unit,r.initialSpin))));
 const item={id:'__core',name:'核心',tag:'core',material:r.core.material,stats:{attack:r.core.attack,defense:r.core.defense},bounds:{min:[-r.core.radius,-r.core.radius,-r.core.radius],max:[r.core.radius,r.core.radius,r.core.radius]}};
 const collider=world.createCollider(RAPIER.ColliderDesc.ball(r.core.radius).setMass(r.core.mass).setRestitution(.7).setFriction(.12),body);
 const core={id:'core',item,mount:'core',collider,maxHp:r.core.hp,hp:r.core.hp,alive:true};
 const parts=def.parts.map((p,i)=>{
  const item=c.items.find(x=>x.id===p.item),offset=attachmentOffset(item,p.mount,p.rot,r),d=RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));if(!d)throw Error(`Invalid hull ${item.id}`);
  const collider=world.createCollider(d.setMass(item.mass).setTranslation(...offset).setRotation(quat(euler(p.rot))).setRestitution(c.materials[item.material].restitution).setFriction(.12),body);
  return {id:`part-${i}`,item,mount:p.mount,rot:p.rot,offset,collider,maxHp:r.attachmentHp,hp:r.attachmentHp,alive:true};
 });
 body.recomputeMassPropertiesFromColliders();
 return {body,core,parts,spin:unit,mass:body.mass(),definition:structuredClone(def)};
}
const active=f=>[f.core,...f.parts.filter(p=>p.alive)];
function surfaceExtent(f,direction,r){
 let extent=r.core.radius;
 for(const p of f.parts)for(const v of p.item.hull){const world=rotate(qarr(f.body.rotation()),add(p.offset,rotate(euler(p.rot),v)));extent=Math.max(extent,dot(world,direction));}
 return extent;
}
/** Removing a part preserves velocity at every surviving material point. */
export function detachPart(world,f,p){
 const pose={pos:arr(p.collider.translation()),quat:qarr(p.collider.rotation())},velocity=bodyPointVelocity(f.body,pose.pos),angularVelocity=arr(f.body.angvel()),oldCenter=arr(f.body.worldCom()),oldVelocity=arr(f.body.linvel()),massBefore=f.body.mass();
 p.alive=false;p.hp=0;p.brokenPose=pose;world.removeCollider(p.collider,true);f.body.recomputeMassPropertiesFromColliders();f.mass=f.body.mass();
 const newCenter=arr(f.body.worldCom()),newVelocity=add(oldVelocity,cross(angularVelocity,sub(newCenter,oldCenter)));
 f.body.setLinvel(vec(newVelocity),true);f.body.setAngvel(vec(angularVelocity),true);
 return {pose,velocity,angularVelocity,massBefore,massAfter:f.mass,oldCenter,newCenter,oldVelocity,newVelocity};
}
function contactVelocity(f,point){return add(f.before.velocity,cross(f.before.angular,sub(point,f.before.center)));}
function tipRatio(p,point){if(p.mount==='core')return 0;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation()))),radius=Math.hypot(...p.item.bounds.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(p.item.bounds.min[i]))));return Math.max(0,Math.min(1,(length(local)/radius-.65)/.35));}
function weakContact(p,point){if(p.mount==='core')return false;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation())));return length(sub(local,p.item.weakPoint.pos))<=p.item.weakPoint.radius;}
export function tierDamage({mode,impulse,attacker,target,materials,matchups,weak=false,tipMultiplier=1,maxHp,roleMultiplier=1,rules:r}){
 const hardness=Math.sqrt(materials[attacker.material].hardness/materials[target.material].hardness),matchup=matchups[attacker.tag]?.[target.tag]??1;
 const score=(mode==='A'?impulse:Math.max(0,attacker.stats.attack*matchup-target.stats.defense))*hardness*tipMultiplier;
 const tier=r.tierThresholds[mode].filter(threshold=>score>=threshold).length;
 const rawDamage=r.tierDamage[tier]*r.damageScale[mode]*(weak?2:1),damageCap=maxHp*(weak?r.weakCritMaxFraction:r.maxHitFraction);
 return {score,tier,hardness,matchup,rawDamage,damageCap,damage:Math.min(rawDamage,damageCap)*roleMultiplier};
}
function contactPair(world,left,right){
 let impulse=0,best=-1,point=null,rightPoint=null,normal=null,penetration=0;
 world.contactPair(left.collider,right.collider,(m,flipped)=>{
  for(let k=0;k<m.numContacts();k++){
   if(m.contactDist(k)>.002)continue;
   penetration=Math.max(penetration,-m.contactDist(k));const j=m.contactImpulse(k);impulse+=j;
   if(j>best){best=j;normal=scale(arr(m.normal()),flipped?-1:1);const a=flipped?m.localContactPoint2(k):m.localContactPoint1(k),b=flipped?m.localContactPoint1(k):m.localContactPoint2(k);if(a)point=add(arr(left.collider.translation()),rotate(qarr(left.collider.rotation()),arr(a)));if(b)rightPoint=add(arr(right.collider.translation()),rotate(qarr(right.collider.rotation()),arr(b)));}
  }
 });
 return point&&rightPoint&&normal?{left,right,impulse,point,rightPoint,normal,penetration}:null;
}
function correctOverlap(world,fs,r){
 let before=0,remaining=0,correction=0;
 for(let i=0;i<=r.overlapIterations;i++){
  let deepest=null;
  for(const p of active(fs[0]))for(const q of active(fs[1])){const hit=p.collider.contactCollider(q.collider,0);if(hit&&hit.distance<0&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
  remaining=deepest?-deepest.distance:0;if(i===0)before=remaining;if(remaining<=r.overlapTolerance||i===r.overlapIterations)break;
  const total=fs[0].mass+fs[1].mass,delta=scale(arr(deepest.normal1),remaining+.0001);
  fs.forEach((f,j)=>f.body.setTranslation(vec(add(arr(f.body.translation()),scale(delta,(j===0?-1:1)*fs[1-j].mass/total))),true));correction+=remaining+.0001;world.propagateModifiedBodyPositionsToColliders();
 }
 let radialCorrection=0;
 if(remaining>r.overlapTolerance){
  // A compound's concave pocket can make deepest-normal projections oscillate.
  // Search an actually clear configuration along the COM separation axis. Both
  // bodies move by mass shares; no velocity/HP change and no move back to arena.
  const origins=fs.map(f=>arr(f.body.translation())),centers=fs.map(f=>arr(f.body.worldCom())),delta=sub(centers[1],centers[0]),distance=length(delta),axis=distance>1e-8?scale(delta,1/distance):[1,0,0],total=fs[0].mass+fs[1].mass;
  const radii=fs.map((f,i)=>Math.max(...active(f).map(p=>p.mount==='core'?length(sub(arr(p.collider.translation()),centers[i]))+r.core.radius:Math.max(...p.item.hull.map(v=>length(sub(add(arr(p.collider.translation()),rotate(qarr(p.collider.rotation()),v)),centers[i])))))));
  const place=amount=>{fs.forEach((f,i)=>f.body.setTranslation(vec(add(origins[i],scale(axis,(i===0?-1:1)*amount*fs[1-i].mass/total))),true));world.propagateModifiedBodyPositionsToColliders();};
  const overlap=()=>{let value=0;for(const p of active(fs[0]))for(const q of active(fs[1])){const hit=p.collider.contactCollider(q.collider,0);if(hit)value=Math.max(value,-hit.distance);}return value;};
  let low=0,high=Math.max(.001,radii[0]+radii[1]-distance+.001);place(high);
  if(overlap()>r.overlapTolerance)throw Error('Compound separation bound did not clear shapes');
  for(let i=0;i<14;i++){const mid=(low+high)/2;place(mid);if(overlap()>r.overlapTolerance)low=mid;else high=mid;}
  place(high);remaining=overlap();radialCorrection=high;correction+=high;
 }
 return {before,remaining,correction,radialCorrection};
}
const name=p=>p.mount==='core'?'核心':p.item.name.replace(/（.*?）/g,'');
/** New, explicit schema. V1 entry and its world/rules stay untouched. */
export async function simulateV3({fighters:definitions,mode='A',seed}){
 if(!['A','B'].includes(mode))throw Error('mode must be A or B');if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 const c=await loadCatalogRules(),r=await loadV3Rules();definitions.forEach(d=>validate(d,c));await ready();
 const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=r.dt;
 try{
 const rng=random(seed),critRng=random(seed^0x9e3779b9),fs=definitions.map((d,i)=>buildFighter(world,d,i,rng,c,r));
 const extents=fs.map((f,i)=>surfaceExtent(f,[i===0?1:-1,0,0],r)),distance=extents[0]+extents[1]+r.initialGap;
 fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*distance/2,y:(rng()-.5)*.08,z:(rng()-.5)*.08},true));world.propagateModifiedBodyPositionsToColliders();
 const initial=fs.map(f=>({definition:f.definition,...fighterFrame(f)})),events=[],frames=[],diagnostics={maxResidualPenetration:0,maxGeometricPenetration:0,maxPositionCorrection:0,correctionSteps:0,radialCorrectionSteps:0,maxRadialCorrection:0,zoneDamage:0,skippedSlowContacts:0};
 let t=0,winner=null,reason='timeout',lastSeen=-Infinity,lastDamage=-Infinity,lastRecoil=-Infinity,lastStrike=null,contactRunSteps=0,contactRunStart=0;
 const scrapeEpisodes=[];
 const closeContactRun=()=>{const duration=contactRunSteps*r.dt;if(duration>=.1-1e-8)scrapeEpisodes.push({start:contactRunStart,end:contactRunStart+duration,duration});contactRunSteps=0;};
 const record=()=>frames.push({t,fighters:fs.map(fighterFrame)});record();
 for(let step=1;step<=Math.round(r.maxDuration/r.dt);step++){
  t=step*r.dt;
  fs.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),delta=sub(arr(fs[1-i].body.worldCom()),p),dist=length(delta),pursuit=t-lastRecoil<r.recoilPause?0:1;
   const acceleration=add(scale(p,-r.attraction),scale(delta,dist>1e-6?r.thrust*pursuit/dist:0));
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);f.body.resetTorques(true);f.body.addTorque(vec(scale(f.spin,f.mass*r.spinTorque)),true);
   const velocity=arr(f.body.linvel()),speed=length(velocity);if(speed>r.speedLimit)f.body.setLinvel(vec(scale(velocity,r.speedLimit/speed)),true);
   f.before={velocity:arr(f.body.linvel()),angular:arr(f.body.angvel()),center:arr(f.body.worldCom())};
  });
  world.step();
  const pairs=[];for(const p of active(fs[0]))for(const q of active(fs[1])){const hit=contactPair(world,p,q);if(hit)pairs.push(hit);}
  // Select across the complete manifold set before causing any damage/removal.
  pairs.sort((a,b)=>b.impulse-a.impulse||a.left.id.localeCompare(b.left.id)||a.right.id.localeCompare(b.right.id));
  const hit=pairs[0];
  // Solver impulses can recur while the same surfaces are still rubbing. Count
  // these continuous runs separately, never as a new attack after a quiet step.
  let touching=pairs.some(p=>p.impulse>=r.minimumImpulse);
  if(!touching)for(const p of active(fs[0]))for(const q of active(fs[1])){const geometry=p.collider.contactCollider(q.collider,.002);if(geometry&&geometry.distance<=.002)touching=true;}
  if(touching){if(contactRunSteps===0)contactRunStart=t-r.dt;contactRunSteps++;}else closeContactRun();
  const newEpisode=Boolean(hit&&hit.impulse>=r.minimumImpulse&&t-lastSeen>r.episodeSeparation&&contactRunSteps*r.dt<=.1+1e-8);
  if(hit){
   const {left,right,point,rightPoint,normal,impulse}=hit;
   const matchupMultipliers=[[left,right],[right,left]].map(([a,b])=>(c.matchups[a.item.tag]?.[b.item.tag]??1)>1?r.counterSpeedMultiplier:1);
   const roles=strikeRoles({normal,velocities:[contactVelocity(fs[0],point),contactVelocity(fs[1],rightPoint)],tipRatios:[tipRatio(left,point),tipRatio(right,rightPoint)],tipBonus:r.tipBonus,seed,masses:fs.map(f=>f.mass),massPower:r.roleMassPower,matchupMultipliers,minimumSpeed:r.minimumClosingSpeed});
   if(newEpisode)events.push({t,type:'contact',point,rightPoint,normal,impulse,parts:[left.id,right.id],items:[left.item.id,right.item.id],closingSpeeds:roles.normalSpeeds,attackScores:roles.scores,attacker:roles.attacker,pairCount:pairs.length});
   if(newEpisode&&roles.attacker!==null&&impulse>=r.minimumImpulse&&t-lastDamage>=r.damageCooldown){
    const pending=[];
    for(const [attacker,target,ap,tp,tpnt] of [[0,1,left,right,rightPoint],[1,0,right,left,point]]){
     const role=attacker===roles.attacker?'attack':'recoil',roleMultiplier=role==='attack'?1:r.recoilDamageFraction;
     const weakTouch=weakContact(tp,tpnt),roll=role==='attack'&&weakTouch?critRng():null,weak=roll!==null&&weakCritical({contact:true,roll,chance:r.weakCritChance});
     const d=tierDamage({mode,impulse,attacker:ap.item,target:tp.item,materials:c.materials,matchups:c.matchups,weak,tipMultiplier:role==='attack'?roles.tipMultiplier:1,maxHp:tp.maxHp,roleMultiplier,rules:r});
     const damage=Math.min(tp.hp,d.damage);
     pending.push({tp,event:{t,type:weak?'weak':'hit',attacker,target,part:ap.id,targetPart:tp.id,item:ap.item.id,targetItem:tp.item.id,mount:ap.mount,targetMount:tp.mount,point:tpnt,impulse,role,strikeAttacker:roles.attacker,normalSpeeds:roles.normalSpeeds,attackScores:roles.scores,masses:fs.map(f=>f.mass),matchupMultipliers,weakContact:weakTouch,weak,criticalRoll:roll,criticalChance:r.weakCritChance,roleMultiplier,tipMultiplier:role==='attack'?roles.tipMultiplier:1,...d,damageBeforeHpClamp:d.damage,damage,caption:weak?`${name(ap)}撞中${name(tp)}弱点`:`${name(tp)}受撞，掉血了`}});
    }
    for(const {tp,event}of pending){tp.hp=Math.max(0,tp.hp-event.damage);event.hpAfter=tp.hp;events.push(event);}
    lastDamage=t;lastStrike=roles.attacker;
   }else if(newEpisode&&roles.attacker===null)diagnostics.skippedSlowContacts++;
   if(t-lastRecoil>=r.contactCooldown&&impulse>=r.minimumImpulse){
    const before=fs.map(f=>arr(f.body.linvel()));fs.forEach((f,i)=>f.body.applyImpulse(vec(scale(normal,(i===0?-1:1)*f.mass*r.recoilSpeed)),true));
    events.push({t,type:'recoil',normal,impulse,velocityBefore:before,velocityAfter:fs.map(f=>arr(f.body.linvel())),recoilSpeed:r.recoilSpeed});lastRecoil=t;
   }
   if(impulse>=r.minimumImpulse)lastSeen=t;
  }
  for(let i=0;i<2;i++)for(const p of fs[i].parts)if(p.alive&&p.hp<=0){const detached=detachPart(world,fs[i],p);events.push({t,type:'break',target:i,targetPart:p.id,item:p.item.id,mount:p.mount,...detached,caption:`${name(p)}碎了`});}
  const projection=correctOverlap(world,fs,r);diagnostics.maxResidualPenetration=Math.max(diagnostics.maxResidualPenetration,projection.remaining);diagnostics.maxGeometricPenetration=Math.max(diagnostics.maxGeometricPenetration,projection.before);diagnostics.maxPositionCorrection=Math.max(diagnostics.maxPositionCorrection,projection.correction);if(projection.correction>0)diagnostics.correctionSteps++;if(projection.radialCorrection>0){diagnostics.radialCorrectionSteps++;diagnostics.maxRadialCorrection=Math.max(diagnostics.maxRadialCorrection,projection.radialCorrection);}
  const dead=fs.map((f,i)=>f.core.hp<=0?i:null).filter(i=>i!==null);
  if(step%r.frameStride===0||dead.length)record();
  if(dead.length){winner=dead.length===2?lastStrike:1-dead[0];reason=dead.length===2?'double-ko':'ko';events.push({t,type:'ko',target:dead.length===2?null:dead[0],winner,caption:winner===null?'双方核心都碎了':`${winner===0?'左':'右'}方撞碎核心，赢了`});break;}
 }
 closeContactRun();diagnostics.scrapeEpisodes=scrapeEpisodes;diagnostics.scrapeCount=scrapeEpisodes.length;diagnostics.scrapeDuration=scrapeEpisodes.reduce((n,e)=>n+e.duration,0);diagnostics.maxScrapeDuration=Math.max(0,...scrapeEpisodes.map(e=>e.duration));
 if(frames.at(-1).t!==t)record();
 // No zone, attrition, ringout, or HP-percentage timeout win. Only core KO wins.
 const cause=events.findLast(e=>e.damage>0&&e.targetPart==='core'&&e.hpAfter===0)??events.filter(e=>e.damage>0&&e.role==='attack').sort((a,b)=>b.damage-a.damage)[0]??null;
 const at=cause?.t??t,t0=Math.max(0,Math.min(t-2.5,at-1.5));
 return {meta:{schemaVersion:3,engine:'rapier3d-compat@0.21.0',seed,mode,duration:t,winner,reason,initial,arenaRadius:r.arenaRadius,anchors:structuredClone(ANCHORS),rules:r,diagnostics},frames,events,decisive:{t0,t1:Math.min(t,t0+2.5),eventIndex:cause?events.indexOf(cause):null,finishType:reason==='timeout'?'timeout':'contact',caption:reason==='timeout'?'时间到，双方核心还在':events.at(-1).caption}};
 }finally{world.free();}
}
