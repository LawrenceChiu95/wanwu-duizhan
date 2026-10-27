import RAPIER from '@dimforge/rapier3d-compat';
import {add,sub,scale,length,vec,arr,quat,qarr,euler,rotate,inverseRotate,random} from './math.js';
let initialized;
const ready=()=>initialized??=(RAPIER.init());
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
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
export function zoneDamageRate(t,maxHp,a){return maxHp*a.zoneDamageMaxFraction*Math.max(0,Math.min(1,(t-a.zoneDamageStart)/(a.maxDuration-a.zoneDamageStart)));}
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
 const maxHp=a.fighterHp;
 return {body,parts,shapes:Array.from({length:body.numColliders()},(_,i)=>body.collider(i)),maxHp,hp:maxHp,spin,definition:structuredClone(def),start,rotation,mass:body.mass(),com:arr(body.localCom())};
}
function contactVelocity(f,point){return add(f.beforeContact.velocity,cross(f.beforeContact.angular,sub(point,f.beforeContact.center)));}
export function strikeRoles({normal,velocities,tipRatios,tipBonus,seed,masses=[1,1],matchupMultipliers=[1,1]}){
 const normalSpeeds=[Math.max(0,dot(velocities[0],normal)),Math.max(0,-dot(velocities[1],normal))];
 const scores=normalSpeeds.map((v,i)=>v*masses[i]*matchupMultipliers[i]*(1+tipBonus*tipRatios[i]));
 const attacker=Math.abs(scores[0]-scores[1])>1e-8?(scores[0]>scores[1]?0:1):(seed&1);
 return {attacker,normalSpeeds,scores,tipRatios,masses,matchupMultipliers,tipMultiplier:1+tipBonus*tipRatios[attacker]};
}
export function weakCritical({contact,roll,chance}){return contact&&roll<chance;}
export function simultaneousWinner({fallen,hp,lastStrike,t,deathCauses}){
 const simultaneousKo=fallen.length===2&&hp.every(value=>value<=0);
 const resolvedByAttacker=simultaneousKo&&lastStrike?.t===t&&deathCauses.length===2&&deathCauses.every(e=>e?.t===t&&['hit','crit','weak'].includes(e.type));
 return {simultaneousKo,resolvedByAttacker,winner:resolvedByAttacker?lastStrike.attacker:fallen.length===2?null:1-fallen[0][0]};
}
function tipRatio(part,point){const local=inverseRotate(qarr(part.collider.rotation()),sub(point,arr(part.collider.translation())));const radius=Math.hypot(...part.item.bounds.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(part.item.bounds.min[i]))));return Math.max(0,Math.min(1,(length(local)/radius-.65)/.35));}
function partFrame(p){return {item:p.item.id,mount:p.mount,pos:arr(p.collider.translation()),quat:qarr(p.collider.rotation())};}
function fighterFrame(f){return {pos:arr(f.body.translation()),quat:qarr(f.body.rotation()),hp:Math.max(0,f.hp),maxHp:f.maxHp,parts:f.parts.map(partFrame)};}
function weakContact(part,point){const local=inverseRotate(qarr(part.collider.rotation()),sub(point,arr(part.collider.translation()))),distance=length(sub(local,part.item.weakPoint.pos));return {local,distance,weak:distance<=part.item.weakPoint.radius};}
function detailFor(e,c){
 if(e.type==='zone')return '留在缩小的安全球外，持续失血。';
 if(e.type==='ringout')return '被撞出了外层球壳，出界落败。';
 if(e.type==='ko')return '血量耗尽，无法继续对撞。';
 const a=c.items.find(i=>i.id===e.item),b=c.items.find(i=>i.id===e.targetItem);
 const mount=e.mount==='core'?'':`${{front:'前',top:'上',side:'侧'}[e.mount]}装的`;
 const cause=e.weak?'撞中弱点且触发暴击，原始伤害翻倍':(e.weakContact?'碰到弱点但未触发暴击；':'')+(e.mode==='A'?`撞击冲量 ${e.impulse.toFixed(1)}，硬度修正 ${e.hardness.toFixed(2)}`:e.matchup>1?`属性克制，攻击放大了 ${e.matchup} 倍`:'接触后按攻击和防御扣血');
 const approach=e.matchupMultipliers[e.strikeAttacker]>1?`属性克制，质量乘迎击速度按 ${e.matchupMultipliers[e.strikeAttacker]} 倍参与攻守判定`:e.masses[e.strikeAttacker]>e.masses[1-e.strikeAttacker]?'质量乘迎击速度占优':e.normalSpeeds[e.strikeAttacker]>e.normalSpeeds[1-e.strikeAttacker]+1e-8?'沿撞击方向冲得更快':'远端接触占优';
 return e.role==='recoil'?`${b.name}承受反震，扣掉 ${e.damage.toFixed(1)} 点血。`:`${mount}${a.name}${approach}${e.tipMultiplier>1.05&&approach!=='远端接触占优'?'，远端接触加成':''}：${cause}${e.rawDamage>e.damageCap?'（扣血受单击上限限制）':''}，扣掉 ${e.damage.toFixed(1)} 点血。`;
}

const shortName=item=>item.name.replace(/（.*?）/g,'');
function captionFor(e,c,labels){
 if(e.type==='zone')return `${labels[e.target]}在圈外，撑不住了`;
 if(e.type==='ringout')return `${labels[e.target]}出了圈，落败了`;
 if(e.type==='ko')return `${labels[e.target]}倒下了`;
 const attacker=c.items.find(i=>i.id===e.item),target=c.items.find(i=>i.id===e.targetItem),a=shortName(attacker),b=shortName(target);
 if(e.role==='recoil')return `${b}撞中${a}后，自己也掉血了`;
 // Explain only an advantage that actually changed this impact. Compare capped
 // damage without each bonus; never credit weight or hardness from appearance.
 const capWithoutWeak=e.weak?c.arena.fighterHp*c.arena.maxHitFraction:e.damageCap;
 const without=(raw,cap=e.damageCap)=>Math.min(raw,cap)*e.roleMultiplier;
 const advantages=[];
 if(e.weak)advantages.push({kind:'weak',gain:e.damage-without(e.rawDamage/2,capWithoutWeak)});
 if(e.hardness>1)advantages.push({kind:'hard',gain:e.damage-without(e.rawDamage/e.hardness)});
 const other=1-e.strikeAttacker,roleGain=e.damage*(1-c.arena.recoilDamageFraction);
 if(e.masses[e.strikeAttacker]>e.masses[other]&&e.attackScores[e.strikeAttacker]/e.masses[e.strikeAttacker]<e.attackScores[other]/e.masses[other])advantages.push({kind:'heavy',gain:roleGain});
 const counterFlipped=e.matchupMultipliers[e.strikeAttacker]>1&&e.attackScores[e.strikeAttacker]/e.matchupMultipliers[e.strikeAttacker]<e.attackScores[other];
 let counterGain=counterFlipped?roleGain:0;
 if(e.mode==='B'&&e.matchup>1){const base=attacker.stats.attack*e.matchup-target.stats.defense,neutral=Math.max(0,attacker.stats.attack-target.stats.defense);if(base>0)counterGain=Math.max(counterGain,e.damage-without(e.rawDamage*neutral/base));}
 advantages.push({kind:'counter',gain:counterGain});
 const reach=Math.max(...attacker.bounds.max.map((v,i)=>v-attacker.bounds.min[i])),targetReach=Math.max(...target.bounds.max.map((v,i)=>v-target.bounds.min[i]));
 if(reach>targetReach&&e.tipMultiplier>1){const tipFlipped=e.attackScores[e.strikeAttacker]/e.tipMultiplier<e.attackScores[other];advantages.push({kind:'reach',gain:Math.max(tipFlipped?roleGain:0,e.damage-without(e.rawDamage/e.tipMultiplier))});}
 const best=advantages.filter(x=>x.gain>1e-8).sort((x,y)=>y.gain-x.gain)[0];
 if(best?.kind==='weak')return `${a}撞中${b}弱点，暴击`;
 if(best?.kind==='counter')return counterFlipped?`${a}克${b}，抢先撞中了`:`${a}克${b}，撞得更疼`;
 if(best?.kind==='heavy')return `${a}更重，撞疼了${b}`;
 if(best?.kind==='hard')return `${a}更硬，撞疼了${b}`;
 if(best?.kind==='reach')return `${a}够得远，戳中了${b}`;
 return `${a}撞中${b}，${b}掉血了`;
}

// Position-level constraint correction complements Rapier's velocity solve.
// Include the base as well as every attachment; preserve pair center of mass.
function correctOverlap(world,fighters){
 let before=0,remaining=0,correction=0;
 for(let iteration=0;iteration<=8;iteration++){
  let deepest=null;
  for(const p of fighters[0].shapes)for(const q of fighters[1].shapes){const hit=p.contactCollider(q,0);if(hit&&hit.distance<0&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
  remaining=deepest?-deepest.distance:0;if(iteration===0)before=remaining;
  if(remaining<=.0005||iteration===8)break;
  const total=fighters[0].mass+fighters[1].mass,delta=scale(arr(deepest.normal1),remaining+.0001);
  fighters.forEach((f,i)=>f.body.setTranslation(vec(add(arr(f.body.translation()),scale(delta,(i===0?-1:1)*fighters[1-i].mass/total))),true));
  correction+=remaining+.0001;world.propagateModifiedBodyPositionsToColliders();
 }
 return {before,remaining,correction};
}
/** Simulate once, then play frames. No wall clock, Math.random or rendering state. */
export async function simulate({fighters:definitions,mode,seed}){
 if(mode!=='A'&&mode!=='B')throw Error('mode must be A or B');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');
 if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 const c=await loadRules();definitions.forEach(d=>validate(d,c));await ready();
 const a=c.arena,world=new RAPIER.World({x:0,y:0,z:0});world.timestep=a.dt;
 try{
 const rng=random(seed),critRng=random(seed^0x9e3779b9),fighters=definitions.map((d,i)=>createFighter(world,d,i,rng,c));
 const initial=fighters.map(f=>({definition:f.definition,pos:f.start,quat:f.rotation,mass:f.mass,centerOfMass:f.com,maxHp:f.maxHp}));
 const frames=[],events=[],contacts=new Map();let lastBodyHit=-Infinity,lastStrike=null,simultaneousKo=false,resolvedByAttacker=false;let t=0,winner=null,reason='timeout',maxPenetration=0,contactFrames=0,longestContact=0,streak=0,maxGeometricPenetration=0,maxResidualPenetration=0,maxPositionCorrection=0,correctionSteps=0;
 const record=()=>frames.push({t,fighters:fighters.map(fighterFrame),zoneRadius:zoneRadius(t,a)});
 record();
 const labels=definitions.map((d,i)=>d.parts.length===1?shortName(c.items.find(item=>item.id===d.parts[0].item)):i===0?'左方':'右方');
 function emit(e){e.detail=detailFor(e,c);e.caption=captionFor(e,c,labels);events.push(e);if(e.damage>0&&fighters[e.target].hp<=0&&!fighters[e.target].deathCause)fighters[e.target].deathCause=e;}
 for(let step=1;step<=Math.round(a.maxDuration/a.dt);step++){
  t=step*a.dt;
  // Pulsed pursuit leaves time for physical recoil; attraction is always much weaker.
  fighters.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),target=arr(fighters[1-i].body.worldCom()),delta=sub(target,p),dist=length(delta);
   const pulse=t-(f.lastImpact??-Infinity)<.6?0:((t%2.4)<1.15?1:.12);
   const acceleration=add(scale(p,-a.attraction),scale(delta,dist>1e-6?a.thrust*pulse/dist:0));
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);
   f.body.resetTorques(true);f.body.addTorque(vec(scale(f.spin,f.mass*a.spinTorque)),true);
   const v=arr(f.body.linvel()),speed=length(v);if(speed>a.speedLimit)f.body.setLinvel(vec(scale(v,a.speedLimit/speed)),true);
  });
  fighters.forEach(f=>f.beforeContact={velocity:arr(f.body.linvel()),angular:arr(f.body.angvel()),center:arr(f.body.worldCom())});
  world.step();
  let touching=false,recoilNormal=null,recoilImpulse=-1;
  for(let pi=0;pi<fighters[0].parts.length;pi++)for(let pj=0;pj<fighters[1].parts.length;pj++){
   const left=fighters[0].parts[pi],right=fighters[1].parts[pj],key=`${pi}:${pj}`;
   let impulse=0,bestImpulse=-1,point=null,rightPoint=null,normal=null,penetration=0;
   world.contactPair(left.collider,right.collider,(m,flipped)=>{
    for(let k=0;k<m.numContacts();k++){
     if(m.contactDist(k)>.002)continue;
     penetration=Math.max(penetration,-m.contactDist(k));const j=m.contactImpulse(k);impulse+=j;
     if(j>bestImpulse){bestImpulse=j;normal=scale(arr(m.normal()),flipped?-1:1);const v=flipped?m.localContactPoint2(k):m.localContactPoint1(k),w=flipped?m.localContactPoint1(k):m.localContactPoint2(k);if(v)point=add(arr(left.collider.translation()),rotate(qarr(left.collider.rotation()),arr(v)));if(w)rightPoint=add(arr(right.collider.translation()),rotate(qarr(right.collider.rotation()),arr(w)));}
    }
   });
   maxPenetration=Math.max(maxPenetration,penetration);
   if(point){touching=true;}
   // A recoil pulse also separates a sustained contact, without awarding a new hit.
   if(point&&normal&&impulse>recoilImpulse){recoilNormal=normal;recoilImpulse=impulse;}
   // One damaging impact per contact episode, not one B hit per physics frame.
   const prior=contacts.get(key);
   if(t>=a.openingGrace&&t-lastBodyHit>=a.damageCooldown&&point&&impulse>.0001&&(!prior||!Number.isFinite(prior.lastHit)||t-prior.lastSeen>.10)&&(!prior||t-prior.lastHit>=a.contactCooldown)){
    const matchupMultipliers=[[left,right],[right,left]].map(([att,tgt])=>(c.matchups[att.item.tag]?.[tgt.item.tag]??1)>1?a.counterSpeedMultiplier:1);
    const roles=strikeRoles({normal,velocities:[contactVelocity(fighters[0],point),contactVelocity(fighters[1],rightPoint)],tipRatios:[tipRatio(left,point),tipRatio(right,rightPoint)],tipBonus:a.tipBonus,seed,masses:fighters.map(f=>f.mass),matchupMultipliers});
    lastStrike={t,attacker:roles.attacker};
    for(const [attacker,target,attPart,tgtPart,targetPoint] of [[0,1,left,right,rightPoint],[1,0,right,left,point]]){
     const contact=weakContact(tgtPart,targetPoint),criticalRoll=contact.weak?critRng():null,weak=weakCritical({contact:contact.weak,roll:criticalRoll,chance:a.weakCritChance}),d=contactDamage({mode,impulse:impulse*a.impulseToDamage,attacker:attPart.item,target:tgtPart.item,materials:c.materials,matchups:c.matchups,weak});
     const role=attacker===roles.attacker?'attack':'recoil',roleMultiplier=role==='attack'?1:a.recoilDamageFraction;
     const damageScale=mode==='B'?a.statDamageScale*d.hardness:1;const tipMultiplier=role==='attack'?roles.tipMultiplier:1;const rawDamage=d.damage*damageScale*tipMultiplier,damageCap=fighters[target].maxHp*(weak?a.weakCritMaxFraction:a.maxHitFraction);d.damage=Math.min(rawDamage,damageCap)*roleMultiplier;
     const e={t,type:weak?'weak':d.damage>=20?'crit':'hit',attacker,target,point:targetPoint,targetLocalPoint:contact.local,weakDistance:contact.distance,weakContact:contact.weak,criticalRoll,criticalChance:a.weakCritChance,item:attPart.item.id,targetItem:tgtPart.item.id,mount:attPart.mount,targetMount:tgtPart.mount,mode,impulse,hardness:d.hardness,matchup:d.matchup,weak,multiplier:d.multiplier,damageScale,role,roleMultiplier,tipMultiplier,strikeAttacker:roles.attacker,normalSpeeds:roles.normalSpeeds,attackScores:roles.scores,masses:roles.masses,tipRatios:roles.tipRatios,matchupMultipliers:roles.matchupMultipliers,rawDamage,damageCap,damage:d.damage};
     fighters[target].hp-=d.damage;emit(e);
    }
    lastBodyHit=t;contacts.set(key,{lastHit:t,lastSeen:t});
   } else if(point)contacts.set(key,{lastHit:prior?.lastHit??-Infinity,lastSeen:t});
  }
  // One recoil per body pair, not one per attachment pair. Repeated pulses can
  // resolve sustained contact but never produce damage without a new impact.
  if(recoilNormal&&t-(fighters[0].lastImpact??-Infinity)>=a.contactCooldown){
   fighters.forEach((f,i)=>{f.body.applyImpulse(vec(scale(recoilNormal,(i===0?-1:1)*f.mass*a.recoilSpeed)),true);f.lastImpact=t;});
  }
  const projection=correctOverlap(world,fighters);maxGeometricPenetration=Math.max(maxGeometricPenetration,projection.before);maxResidualPenetration=Math.max(maxResidualPenetration,projection.remaining);maxPositionCorrection=Math.max(maxPositionCorrection,projection.correction);if(projection.correction>0)correctionSteps++;
  if(touching){streak+=a.dt;contactFrames++;longestContact=Math.max(longestContact,streak);}else streak=0;
  const fallen=[];
  fighters.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),r=length(p);
   if(r>a.radius){emit({t,type:'ringout',attacker:1-i,target:i,point:p,item:null,damage:0});fallen.push([i,'ringout']);}
   // Zone damage integrated every fixed step; events grouped at 0.5 s for readable playback.
   if(f.hp>0&&r>zoneRadius(t,a)){
    const damage=zoneDamageRate(t,f.maxHp,a)*a.dt;f.hp-=damage;f.zonePending=(f.zonePending??0)+damage;
   }
   if((step%30===0||f.hp<=0||r>a.radius)&&f.zonePending>0){emit({t,type:'zone',attacker:null,target:i,point:p,item:null,damage:f.zonePending});f.zonePending=0;}
   if(f.hp<=0&&!fallen.some(([j])=>j===i)){emit({t,type:'ko',attacker:1-i,target:i,point:p,item:null,damage:0});fallen.push([i,'ko']);}
  });
  if(step%2===0||fallen.length)record();
  if(fallen.length){({winner,simultaneousKo,resolvedByAttacker}=simultaneousWinner({fallen,hp:fighters.map(f=>f.hp),lastStrike,t,deathCauses:fighters.map(f=>f.deathCause)}));reason=fallen.length===2?'double-ko':fallen[0][1];break;}
 }
 fighters.forEach((f,i)=>{if(f.zonePending>0){emit({t,type:'zone',attacker:null,target:i,point:arr(f.body.worldCom()),item:null,damage:f.zonePending});f.zonePending=0;}});
 if(frames.at(-1).t!==t)record();
 if(reason==='timeout'){
  const remaining=fighters.map(f=>Math.max(0,f.hp)/f.maxHp);
  winner=remaining[0]===remaining[1]?null:remaining[0]>remaining[1]?0:1;
 }
 const decisiveEvent=events.findLast(e=>['ko','ringout'].includes(e.type))??events.filter(e=>e.type==='weak'||e.type==='crit').sort((x,y)=>y.damage-x.damage)[0]??events.filter(e=>e.type==='hit').sort((x,y)=>y.damage-x.damage)[0];
 // For KO, show the actual last damaging cause, not a fabricated range/weakness story.
 let cause=decisiveEvent;
 if(cause?.type==='ko')cause=fighters[resolvedByAttacker?1-winner:cause.target].deathCause??cause;
 const finishType=reason==='timeout'?'timeout':reason==='ringout'?'ringout':cause?.type==='zone'?'zone':'contact';
 let caption=cause?.caption??'双方都还站着';
 let detail=cause?.detail??caption;
 if(cause?.type==='zone'){
  cause=events.filter(e=>['hit','crit','weak'].includes(e.type)).sort((x,y)=>y.damage-x.damage)[0]??cause;
  detail=`${cause.type==='zone'?'':`最大撞击：${cause.detail}`}最后是在圈外掉血输的。`;
  caption=`${labels[decisiveEvent.target]}在圈外撑不住，倒下了`;
 }
 if(reason==='timeout'){caption=winner===null?'时间到，双方平局':`时间到，${labels[winner]}剩血多，赢了`;detail=winner===null?'时间到，剩血比例相同，本局平局。':'时间到，按剩血百分比判胜。';}
 if(resolvedByAttacker)detail+='双方这一撞都归零，按本次攻方判胜。';
 const at=reason==='timeout'?t:cause?.t??t;
 const t0=Math.max(0,Math.min(t-2.5,at-1.5)),t1=Math.min(t,t0+2.5);
 const decisive={t0,t1,caption,detail,eventIndex:reason==='timeout'?null:cause?events.indexOf(cause):null,finishType,finishEventIndex:reason==='timeout'?null:events.indexOf(reason==='ringout'?decisiveEvent:decisiveEvent?.type==='ko'?fighters[resolvedByAttacker?1-winner:decisiveEvent.target].deathCause:cause)};
 return {meta:{seed,mode,duration:t,winner,reason,initial,arenaRadius:a.radius,engine:'rapier3d-compat@0.21.0',schemaVersion:1,simultaneousKo,resolvedByAttacker,diagnostics:{maxPenetration,maxGeometricPenetration,maxResidualPenetration,maxPositionCorrection,correctionSteps,contactFrames,longestContact}},frames,events,decisive};
 }finally{world.free();}
}
