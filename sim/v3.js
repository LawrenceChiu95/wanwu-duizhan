import RAPIER from '@dimforge/rapier3d-compat';
import {loadRules as loadCatalogRules, strikeRoles, weakCritical, ratingScores, itemHardness} from './index.js';
import {add,sub,scale,vec,arr,quat,qarr,rotate,inverseRotate,random} from './math.js';
// Portable math only: replays must be byte-identical across JS engines. Chrome 156 and Node 18/25 disagree in the
// last bit of Math.exp (and earlier Math.pow) for some inputs, so this file uses + - * / and Math.sqrt (IEEE exact)
// and no exp/log/pow/sin/cos/hypot.
const hyp=(...a)=>{let s=0;for(const x of a)s+=x*x;return Math.sqrt(s);};
const length=a=>hyp(...a);
const S2=Math.SQRT1_2;
/** Unit direction in the equator plane for a slot angle in degrees; multiples of 45° only (exact constants). */
function slotDirection(deg){const k=((deg%360)+360)%360,table={0:[0,1],45:[S2,S2],90:[1,0],135:[S2,-S2],180:[0,-1],225:[-S2,-S2],270:[-1,0],315:[-S2,S2]}[k];if(!table)throw Error(`Slot angle ${deg} must be a multiple of 45 degrees`);return [table[0],0,table[1]];}
let initialized, rulesPromise;
const ready=()=>initialized??=RAPIER.init();
/** Starts the physics engine early (the same one-time start a match would do): 评委版 fetches it as a file after its first screen. */
export const warmEngine=()=>ready();
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const UP=[0,1,0];
const horizontalUnit=([x,,z])=>{const n=hyp(x,z);return n>1e-6?[x/n,0,z/n]:[0,0,0];};
const flat=(a,b)=>horizontalUnit(sub(b,a));
function keepCoresOnPlane(world,fs){
 let moved=false;
 for(const f of fs){
  const p=f.body.translation(),v=f.body.linvel();
  // Rapier constrains the centre of mass. A tilted off-centre assembly can
  // still move the rigid body's origin, which is where the core is mounted.
  if(p.y!==0){f.body.setTranslation({x:p.x,y:0,z:p.z},true);moved=true;}
  if(v.y!==0)f.body.setLinvel({x:v.x,y:0,z:v.z},true);
 }
 if(moved)world.propagateModifiedBodyPositionsToColliders();
}
function planeNormal(normal,fs){
 const n=horizontalUnit(normal);
 return n[0]||n[2]?n:flat(arr(fs[0].body.translation()),arr(fs[1].body.translation()));
}
// The opening and active moves use the original forces. This profile only changes free motion after the first rebound.
const BOUNCE={attraction:6,thrust:0,recoilSpeed:1.55};
// The independent twelve-item trial shortens long matches without altering legacy replays.
const TRIAL_DAMAGE_RAMP=[[0,.75],[15,.9],[25,1.65],[33,7]];
// Elara 64b06142 selected inward motion before contact. capHp is the original nine-item mean.
export const POSITION_COMBAT_RULES=Object.freeze({
 radiusTolerance:.03,recoilBase:.96,recoilLength:.02,outBonus:.08,
 rangeAttack:.4,rangeHp:.8,capHp:60.800000000000004,
 roleMode:'inward',inwardWindow:.15,inwardTolerance:.1
});
// Explicitly selected only by the judge candidate. Replays store the full tuning in combatRules.
export const JUDGE_POSITION_COMBAT_RULES=Object.freeze({
 ...POSITION_COMBAT_RULES,
 bareCoreReceive:2.5,
 bareCoreByPartsOnly:true,
 coreMassImpact:1.5,
 coreFinishMultiplier:1.55,
 autoBDamageScale:.8,
 broadHeavyResistance:true,
 coreLoadout:Object.freeze({mainShare:.9,attackGain:3.4,durabilityGain:1.2}),
 weightFeel:Object.freeze({
  slenderMinLength:.30,slenderMinRatio:2.5,lightMass:1.05,heavyMass:3.10,
  dashLoss:.28,recenterLoss:.48,recenterBoost:.85
 })
});
export const HEAVY_JUDGE_COMBAT_OPTIONS=Object.freeze({
 combat:'position',
 combatRules:Object.freeze({...JUDGE_POSITION_COMBAT_RULES,broadHeavyMidHit:true}),
 feelRules:Object.freeze({...BOUNCE,thrust:4})
});
export const PLANAR_JUDGE_COMBAT_OPTIONS=Object.freeze({
 ...HEAVY_JUDGE_COMBAT_OPTIONS,
 combatRules:Object.freeze({...HEAVY_JUDGE_COMBAT_OPTIONS.combatRules,lockCorePlane:true,planeOverlapCorrectionCap:.04,dashAimLockTime:.08,weakHitFloor:.5})
});
export const IMPACT_JUDGE_COMBAT_OPTIONS=Object.freeze({
 ...PLANAR_JUDGE_COMBAT_OPTIONS,
 feelRules:Object.freeze({...PLANAR_JUDGE_COMBAT_OPTIONS.feelRules,thrust:1.5,recoilSpeed:.75}),
 combatRules:Object.freeze({...PLANAR_JUDGE_COMBAT_OPTIONS.combatRules,impactControls:true,impactDashContacts:true,resolveMutualDashContact:true,refinedImpact:true,hpScale:1.37,mangHpScale:1.15})
});
export const OPENING_JUDGE_COMBAT_OPTIONS=Object.freeze({
 ...IMPACT_JUDGE_COMBAT_OPTIONS,
 combatRules:Object.freeze({...IMPACT_JUDGE_COMBAT_OPTIONS.combatRules,
  opening:Object.freeze({gap:.95,rampSeconds:.7,aiDashAfter:.4})})
});
export const GUARD_TIMING_JUDGE_COMBAT_OPTIONS=Object.freeze({
 ...OPENING_JUDGE_COMBAT_OPTIONS,
 combatRules:Object.freeze({...OPENING_JUDGE_COMBAT_OPTIONS.combatRules,
  opening:Object.freeze({...OPENING_JUDGE_COMBAT_OPTIONS.combatRules.opening,minAiDashTime:1.5}),
  guardTiming:Object.freeze({aiCharge:.55,aiDashJitter:1.5,blockTime:.50,blockCooldown:3.5,perfectTime:.18,wenBlockLead:.85,changBlockLead:.12})})
});
const IMPACT={playerCharge:.075,playerAimLockSteps:2,blockTime:.375,emptyGuardDashLock:.45,stun:.5,heavyMissStun:.25,
 passiveSpeedLimit:1,launchSpeed:2.25,launchGain:.18,launchLimit:3.5,dashDamage:2.2,heavyTurnLoss:.55,
 contactMinSpeed:.75,contactMinAlignment:.45};

export async function loadV3Rules(){
 rulesPromise??=(async()=>{const url=new URL('./v3-rules.json',import.meta.url);if(url.protocol==='file:'){const fs=await import('node:fs/promises');return JSON.parse(await fs.readFile(url,'utf8'));}const r=await fetch(url);if(!r.ok)throw Error(`v3 rules HTTP ${r.status}`);return r.json();})();
 return structuredClone(await rulesPromise);
}
export {loadCatalog} from './index.js';
export function openingDistance(extents,r,opening){
 const combined=extents[0]+extents[1];
 if(!opening)return combined+r.initialGap;
 // Widen only as far as the larger top's sweep fits between its spawn and the wall.
 const available=2*(r.arenaRadius-.02-Math.max(...extents))-combined;
 return combined+Math.min(opening.gap,Math.max(r.initialGap,available));
}
function validate(def,c,r){
 if(!def||!Array.isArray(def.parts)||def.parts.length>2)throw Error('v3 requires a core sphere with zero, one or two attachments');
 const used=new Set(),items=new Set();
 for(const p of def.parts){const item=c.items.find(i=>i.id===p.item);if(!item)throw Error(`Unknown item ${p.item}`);itemCombat(item,r);if(items.has(p.item))throw Error('Duplicate attachments are outside this prototype');items.add(p.item);if(!Object.hasOwn(r.top.slots,p.mount)||used.has(p.mount))throw Error('Each attachment needs a unique equator slot');used.add(p.mount);if(!r.top.orients.includes(p.orient))throw Error(`orient must be one of ${r.top.orients.join(', ')}`);}
}
/** Rotation matrix columns (item x, y, z axes in body frame) to a quaternion [x,y,z,w]. */
function basisQuat(cx,cy,cz){
 const m00=cx[0],m10=cx[1],m20=cx[2],m01=cy[0],m11=cy[1],m21=cy[2],m02=cz[0],m12=cz[1],m22=cz[2],tr=m00+m11+m22;let q;
 if(tr>0){const s=Math.sqrt(tr+1)*2;q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
 else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
 else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
 else{const s=Math.sqrt(1+m22-m00-m11)*2;q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];}
 const n=hyp(...q);return q.map(v=>v/n);
}
/** Item axes by extent: long, middle, thin (indices into x, y, z). */
export function itemAxes(item){const ext=item.bounds.max.map((v,i)=>v-item.bounds.min[i]),order=[0,1,2].sort((a,b)=>ext[b]-ext[a]||a-b);return {long:order[0],mid:order[1],thin:order[2],ext};}
/**
 * Battle-top mount on the core's equator (body XZ plane, spin axis +Y).
 * out: long axis points radially outward (the configured end first), thin axis along the spin axis.
 * hug: long axis along the spin axis, thin axis radial, broad face against the core.
 * The inner end sinks `embed` into the core so it reads as stuck on. No non-uniform scale.
 */
export function mountTransform(item,mount,orient,r){
 const d=slotDirection(r.top.slots[mount]),{long,thin,ext}=itemAxes(item),cols=[null,null,null];
 if(orient==='out'){cols[long]=scale(d,item.outEnd??r.top.outEnd[item.id]??1);cols[thin]=UP;}
 else{
  let up=long,side=thin,sign=1;
  if(item.photoPhysics){
   // Near-upright photos keep their original top; only clearly sideways
   // objects (longest edge at least 20% taller than Y) raise the outer end.
   if(ext[long]<ext[1]*1.2){up=1;side=[0,2].sort((a,b)=>ext[a]-ext[b]||a-b)[0];}
   else sign=item.outEnd??1;
  }
  cols[up]=scale(UP,sign);cols[side]=d;
 }
 const m=cols.indexOf(null);cols[m]=cross(cols[(m+1)%3],cols[(m+2)%3]);
 const q=basisQuat(...cols),nearest=Math.min(...item.hull.map(v=>dot(rotate(q,v),d)));
 return {offset:scale(d,r.core.radius-r.top.embed-nearest),quat:q,direction:d};
}
/** Body-frame extents of a mounted part (for drawing): slot angle, radial and height range of its hull. */
export function mountExtents(item,mount,orient,r){
 const {offset,quat:q}=mountTransform(item,mount,orient,r),pts=item.hull.map(v=>add(offset,rotate(q,v))),rad=pts.map(p=>hyp(p[0],p[2])),ys=pts.map(p=>p[1]);
 return {offset,quat:q,theta:r.top.slots[mount]*Math.PI/180,r0:Math.min(...rad),r1:Math.max(...rad),y0:Math.min(...ys),y1:Math.max(...ys)};
}
const bodyPointVelocity=(body,point)=>add(arr(body.linvel()),cross(arr(body.angvel()),sub(point,arr(body.worldCom()))));
function partFrame(p){return {id:p.id,item:p.item.id==='__core'?null:p.item.id,mount:p.mount,orient:p.orient,pos:p.alive?arr(p.collider.translation()):p.brokenPose.pos,quat:p.alive?qarr(p.collider.rotation()):p.brokenPose.quat,hp:p.hp,maxHp:p.maxHp,alive:p.mount==='core'?p.hp>0:p.alive};}
function fighterFrame(f){return {pos:arr(f.body.translation()),quat:qarr(f.body.rotation()),hp:f.core.hp,maxHp:f.core.maxHp,core:partFrame(f.core),parts:f.parts.map(partFrame),velocity:arr(f.body.linvel()),angularVelocity:arr(f.body.angvel()),mass:f.mass,centerOfMass:arr(f.body.worldCom())};}
/** Moment of inertia about the body's spin axis (local +Y). */
function spinInertia(body){const I=arr(body.principalInertia()),local=inverseRotate(qarr(body.principalInertiaLocalFrame()),UP);return I[0]*local[0]*local[0]+I[1]*local[1]*local[1]+I[2]*local[2]*local[2];}
/** A fixed 64-sided tangent enclosure. Walls only take solver impulses, never fighter damage/events.
 * The recurrence uses fixed IEEE constants so Node/WebKit/Chrome build identical collider transforms.
 * Eight metres tall covers the existing +/-1.1m vertical motion and the longest upright attachment.
 */
function buildArena(world,r){
 const c=0.9951847266721969,s=0.0980171403295606,thickness=.12;
 const width=(r.arenaRadius+thickness)*0.04912684976946725;
 let x=1,z=0;
 for(let i=0;i<64;i++){
  const q=basisQuat([z,0,-x],UP,[x,0,z]);
  world.createCollider(RAPIER.ColliderDesc.cuboid(width,4,thickness/2).setTranslation(x*(r.arenaRadius+thickness/2),0,z*(r.arenaRadius+thickness/2)).setRotation(quat(q)).setRestitution(.7).setFriction(.12));
  [x,z]=[x*c-z*s,z*c+x*s];
 }
}
function isSlender(item,weightFeel){
 const {long,mid,ext}=itemAxes(item);
 return ext[long]>=weightFeel.slenderMinLength&&ext[long]>=ext[mid]*weightFeel.slenderMinRatio;
}
/** The same per-object scores the library displays drive combat; total rarity adds no hidden bonus. */
export function itemCombat(item,r,positionRules){
 if(item.id==='__core')return {hp:r.core.hp,power:1,attack:r.core.attack,defense:r.core.defense};
 const scores=ratingScores(item);
 if(!scores)throw Error(`物品“${item.name??item.id}”（${item.id}）缺评分或评分无效：攻击、范围、耐久必须都是0–100的有限数字`);
 const {attack,durability,range}=scores,k=r.top.itemStats;
 let q=range/100-.5;
 const weightFeel=positionRules?.weightFeel;
 if(weightFeel){
  const {long,ext}=itemAxes(item);
  q=isSlender(item,weightFeel)?Math.min(.5,ext[long]/1.6):0;
 }
 const power=positionRules?1+positionRules.rangeAttack*q:1,hp=positionRules?1-positionRules.rangeHp*q:1;
 return {hp:r.attachmentHp*(k.hpBase+k.hpScale*durability)*hp,power:(k.powerBase+k.powerScale*attack)*power,attack:(k.attackBase+k.attackScale*attack)*power,defense:k.defenseBase+k.defenseScale*durability};
}
// The starting loadout defines the core. Losing a part still changes the live mass.
function coreLoadoutStats(parts,{mainShare,attackGain,durabilityGain}){
 if(!parts.length)return {attack:1,defense:1,attackScore:15};
 const scores=parts.map(p=>ratingScores(p.item));
 const out=parts.map(p=>p.orient==='out');
 const firstShare=out[0]===out[1]?.5:out[0]?mainShare:1-mainShare;
 const score=key=>scores.length===1?scores[0][key]:
  scores[0][key]*firstShare+scores[1][key]*(1-firstShare);
 const attackScore=score('attack');
 return {attackScore,attack:Math.max(.15,1+(attackScore-15)/50*attackGain),
  defense:Math.max(.35,1+(score('durability')-62)/50*durabilityGain)};
}
function buildFighter(world,def,index,c,r,openingHalfTurn,positionRules,hpScale){
 const spin=r.top.spinRate*r.top.spinDirections[index];
 const desc=RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false).setLinearDamping(r.linearDamping).setAngularDamping(r.angularDamping);
 if(positionRules?.lockCorePlane)desc.enabledTranslations(true,false,true);
 const body=world.createRigidBody(desc);
 const item={id:'__core',name:'核心',tag:'core',material:r.core.material,stats:{attack:r.core.attack,defense:r.core.defense},bounds:{min:[-r.core.radius,-r.core.radius,-r.core.radius],max:[r.core.radius,r.core.radius,r.core.radius]}};
 const collider=world.createCollider(RAPIER.ColliderDesc.ball(r.core.radius).setMass(r.core.mass).setRestitution(.7).setFriction(.12),body);
 const coreHp=r.core.hp*hpScale;
 const core={id:'core',item,mount:'core',orient:'core',collider,baseHp:r.core.hp,maxHp:coreHp,hp:coreHp,alive:true};
 const parts=def.parts.map((p,i)=>{
  const item=c.items.find(x=>x.id===p.item),{offset,quat:q}=mountTransform(item,p.mount,p.orient,r),d=RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));if(!d)throw Error(`Invalid hull ${item.id}`);
  const collider=world.createCollider(d.setMass(item.mass).setTranslation(...offset).setRotation(quat(q)).setRestitution(c.materials[item.material].restitution).setFriction(.12),body);
  const baseHp=itemCombat(item,r,positionRules).hp,hp=baseHp*hpScale;
  const resistWeakHits=positionRules?.broadHeavyResistance&&item.mass>=1.5&&!isSlender(item,positionRules.weightFeel);
  return {id:`part-${i}`,item,mount:p.mount,orient:p.orient,offset,localQuat:q,collider,baseHp,maxHp:hp,hp,alive:true,resistWeakHits};
 });
 body.recomputeMassPropertiesFromColliders();
 // Opposite sides face each other by a half turn, without reflecting handed geometry.
 const q=index===(openingHalfTurn?1:0)?[0,0,0,1]:[0,1,0,0];body.setRotation(quat(q),true);body.setAngvel(vec(scale(rotate(q,UP),spin)),true);
 const coreStats=positionRules?.coreLoadout?coreLoadoutStats(parts,positionRules.coreLoadout):null;
 return {body,core,parts,spin,mass:body.mass(),inertia:spinInertia(body),definition:structuredClone(def),coreStats};
}
const active=f=>[f.core,...f.parts.filter(p=>p.alive)];
/** Radius the spinning top sweeps in its equator plane (core included). */
function sweepRadius(f,r){let extent=r.core.radius;for(const p of f.parts.filter(p=>p.alive))for(const v of p.item.hull){const w=add(p.offset,rotate(p.localQuat,v));extent=Math.max(extent,hyp(w[0],w[2]));}return extent;}
/** Removing a part preserves velocity at every surviving material point. */
export function detachPart(world,f,p){
 const pose={pos:arr(p.collider.translation()),quat:qarr(p.collider.rotation())},velocity=bodyPointVelocity(f.body,pose.pos),angularVelocity=arr(f.body.angvel()),oldCenter=arr(f.body.worldCom()),oldVelocity=arr(f.body.linvel()),massBefore=f.body.mass();
 p.alive=false;p.hp=0;p.brokenPose=pose;world.removeCollider(p.collider,true);f.body.recomputeMassPropertiesFromColliders();f.mass=f.body.mass();f.inertia=spinInertia(f.body);
 const newCenter=arr(f.body.worldCom()),newVelocity=add(oldVelocity,cross(angularVelocity,sub(newCenter,oldCenter)));
 f.body.setLinvel(vec(newVelocity),true);f.body.setAngvel(vec(angularVelocity),true);
 return {pose,velocity,angularVelocity,massBefore,massAfter:f.mass,oldCenter,newCenter,oldVelocity,newVelocity};
}
// mass^p for the strike-role score, built from sqrt only (see the portable-math note at the top).
const massWeight=(m,p)=>{const r=Math.sqrt(m),q=Math.sqrt(r);if(p===1)return m;if(p===.75)return r*q;if(p===.5)return r;if(p===.25)return q;throw Error('roleMassPower must be 0.25, 0.5, 0.75 or 1 (portable math)');};
/** Near-equal scores are a head-on clash, not a one-sided blow selected by Float32 round-off. */
export function topStrikeRoles(options,relativeTolerance){
 const roles=strikeRoles(options),high=Math.max(...roles.scores);
 const clash=Math.max(...roles.normalSpeeds)>=options.minimumSpeed&&high>0&&Math.abs(roles.scores[0]-roles.scores[1])<=high*relativeTolerance;
 return {...roles,clash,attacker:clash?null:roles.attacker};
}
/** The core position is visible to the player; offset attachments do not move this reference. */
export function positionStrikeRoles(roles,positions,tolerance,tipBonus){
 const radii=positions.map(p=>hyp(p[0],p[2])),clash=Math.abs(radii[0]-radii[1])<=tolerance,attacker=clash?null:radii[0]>radii[1]?0:1;
 return {...roles,clash,attacker,tipMultiplier:clash?1:1+tipBonus*roles.tipRatios[attacker],positionRadii:radii};
}
/** Alternative position rules are measured separately from the radius-only candidate. */
export function alternativePositionRoles(roles,{mode,radii,priorRadii,elapsed,reach},tolerance,tipBonus){
 const values=mode==='inward'?radii.map((radius,i)=>Math.max(0,(priorRadii[i]-radius)/elapsed)):radii.map((radius,i)=>radius-reach[i]);
 const clash=Math.abs(values[0]-values[1])<=tolerance,attacker=clash?null:values[0]>values[1]?0:1;
 return {...roles,clash,attacker,tipMultiplier:clash?1:1+tipBonus*roles.tipRatios[attacker],positionRadii:radii,positionValues:values,positionMode:mode};
}
export function partRecoilFactor(part,rules){
 if(part.mount==='core')return 1;
 const longest=Math.max(...part.item.bounds.max.map((v,i)=>v-part.item.bounds.min[i]));
 return rules.recoilBase+rules.recoilLength*longest/.8+(part.orient==='out'?rules.outBonus:0);
}
function contactVelocity(f,point){return add(f.before.velocity,cross(f.before.angular,sub(point,f.before.center)));}
function tipRatio(p,point){if(p.mount==='core')return 0;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation()))),radius=hyp(...p.item.bounds.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(p.item.bounds.min[i]))));return Math.max(0,Math.min(1,(length(local)/radius-.65)/.35));}
function weakContact(p,point){if(p.mount==='core')return false;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation())));return length(sub(local,p.item.weakPoint.pos))<=p.item.weakPoint.radius;}
export function tierDamage({mode,impulse,attacker,target,materials,matchups,weak=false,tipMultiplier=1,maxHp,roleMultiplier=1,ramp=1,attackerOrient='core',targetOrient='core',rules:r,positionRules,coreMasses,coreLoadout}){
 const attack=itemCombat(attacker,r,positionRules),defend=itemCombat(target,r,positionRules);
 // Hardness rewards the striker; a soft target no longer raises the damage tier just for being soft.
 const hardness=Math.sqrt(itemHardness(attacker,materials)/r.top.referenceHardness),matchup=matchups[attacker.tag]?.[target.tag]??1;
 const score=(mode==='A'?impulse:Math.max(0,attack.attack*matchup-defend.defense))*hardness*tipMultiplier;
 const tier=r.tierThresholds[mode].filter(threshold=>score>=threshold).length;
 // Per-object power and mounting trade-off apply before the existing per-hit cap.
 const attackMultiplier=r.top?.orientPower?.[attackerOrient]??1,receiveMultiplier=(r.top?.orientReceive?.[targetOrient]??1)*(targetOrient==='hug'?(r.top.softHugReceive[target.material]??1):1);
 // Core attack and defence are identical before assembly weight is considered.
 const strength=positionRules?.coreMassImpact;
 const weightedCore=strength>0&&attacker.id==='__core'&&target.id==='__core'&&coreMasses;
 let massImpact=1;
 if(weightedCore){
  const [from,to]=coreMasses;
  // Limit the advantage when a heavy top meets a nearly bare core.
  const advantage=Math.min(3,1+strength*(Math.max(from,to)/Math.min(from,to)-1));
  massImpact=from>=to?advantage:1/advantage;
 }
 const rawDamage=r.tierDamage[tier]*r.damageScale[mode]*(weak?2:1)*ramp*attack.power*attackMultiplier*receiveMultiplier*massImpact,damageCap=(target.id!=='__core'&&positionRules?.capHp!==undefined?positionRules.capHp:maxHp)*(weak?r.weakCritMaxFraction:r.maxHitFraction);
 const coreScale=attacker.id==='__core'&&target.id==='__core'?(positionRules?.coreDamageScale??1):1;
 const loadoutImpact=coreLoadout&&attacker.id==='__core'&&target.id==='__core'
  ?coreLoadout.attack/coreLoadout.defense:undefined;
 const hitDamage=Math.min(rawDamage,damageCap);
 // Let a strong assembly deal more than the base core cap, within a bounded per-hit bonus.
 const coreLoadoutCap=loadoutImpact===undefined?damageCap:damageCap*1.25;
 return {score,tier,hardness,matchup,itemPower:attack.power,attackMultiplier,receiveMultiplier,...(weightedCore&&{massImpact}),
  ...(loadoutImpact!==undefined&&{loadoutImpact}),rawDamage,damageCap:coreLoadoutCap,
  damage:(loadoutImpact===undefined?hitDamage:Math.min(hitDamage*loadoutImpact,coreLoadoutCap))*roleMultiplier*coreScale};
}
/** Loose start, tight finish: real hits count for a little less early and more late (piecewise linear in time). Never damage without a hit. */
// Same-step double break: overkill[i] is the damage past zero dealt to core i. Less overkill wins; a tie is a draw.
export function doubleKoWinner(overkill){return overkill[0]<overkill[1]?0:overkill[1]<overkill[0]?1:null;}
/** At the time limit compare core HP ratios first, then the remaining HP of live parts. */
export function timeoutVerdict(fighters){
 const coreRatios=fighters.map(f=>f.core.hp/f.core.maxHp),partHp=fighters.map(f=>f.parts.reduce((sum,p)=>sum+(p.alive?Math.max(0,p.hp):0),0));
 const compare=values=>values[0]>values[1]?0:values[1]>values[0]?1:null;
 let winner=compare(coreRatios),criterion='core-hp-ratio';
 if(winner===null){winner=compare(partHp);criterion=winner===null?'draw':'part-hp';}
 return {winner,why:{kind:'timeout',criterion,coreRatios,partHp}};
}
export function damageRamp(t,points){if(!points?.length)return 1;if(t<=points[0][0])return points[0][1];for(let i=1;i<points.length;i++)if(t<=points[i][0]){const [t0,v0]=points[i-1],[t1,v1]=points[i];return v0+(v1-v0)*(t-t0)/(t1-t0);}return points.at(-1)[1];}
function contactPair(world,left,right){
 let impulse=0,best=-1,point=null,rightPoint=null,normal=null,penetration=0;
 world.contactPair(left.collider,right.collider,(m,flipped)=>{
  for(let k=0;k<m.numContacts();k++){
   // A predictive contact (still a few mm apart) that already took solver impulse is the real impact step.
   if(m.contactDist(k)>.002&&!(m.contactImpulse(k)>0))continue;
   penetration=Math.max(penetration,-m.contactDist(k));const j=m.contactImpulse(k);impulse+=j;
   if(j>best){best=j;normal=scale(arr(m.normal()),flipped?-1:1);const a=flipped?m.localContactPoint2(k):m.localContactPoint1(k),b=flipped?m.localContactPoint1(k):m.localContactPoint2(k);if(a)point=add(arr(left.collider.translation()),rotate(qarr(left.collider.rotation()),arr(a)));if(b)rightPoint=add(arr(right.collider.translation()),rotate(qarr(right.collider.rotation()),arr(b)));}
  }
 });
 return point&&rightPoint&&normal?{left,right,impulse,point,rightPoint,normal,penetration}:null;
}
/**
 * Position-level overlap correction along the deepest contact normal, preserving the pair's centre
 * of mass. The total move per step is capped so a wedged compound never jumps; what is left is
 * worked off over the next steps (and by the solver). No velocity or HP change.
 */
function correctOverlap(world,fs,r,planar,planeOverlapCorrectionCap){
 let before=0,remaining=0,correction=0;
 for(let i=0;i<=r.overlapIterations;i++){
  let deepest=null;
  for(const p of active(fs[0]))for(const q of active(fs[1])){const hit=p.collider.contactCollider(q.collider,0);if(hit&&hit.distance<0&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
  remaining=deepest?-deepest.distance:0;if(i===0)before=remaining;
  const budget=(planeOverlapCorrectionCap??r.top.maxCorrectionPerStep)-correction;
  if(remaining<=r.overlapTolerance||i===r.overlapIterations||budget<=1e-9)break;
  const normal=arr(deepest.normal1);
  // Horizontal movement only clears the horizontal component of an inclined contact.
  const separation=planeOverlapCorrectionCap!==undefined?(remaining+.0001)/Math.max(.1,Math.hypot(normal[0],normal[2])):remaining+.0001;
  const amount=Math.min(separation,budget),total=fs[0].mass+fs[1].mass;
  const delta=scale(planar?planeNormal(normal,fs):normal,amount);
  fs.forEach((f,j)=>f.body.setTranslation(vec(add(arr(f.body.translation()),scale(delta,(j===0?-1:1)*fs[1-j].mass/total))),true));correction+=amount;world.propagateModifiedBodyPositionsToColliders();
 }
 return {before,remaining,correction};
}
/** Spin motor (torque-limited, so heavy or long tops spin up slower) and self-righting toward world up. */
function driveSpin(f,r){
 const u=rotate(qarr(f.body.rotation()),UP),w=arr(f.body.angvel()),s=dot(w,u),perp=sub(w,scale(u,s));
 const step=r.top.spinTorque/f.inertia*r.dt,spin=s+Math.max(-step,Math.min(step,f.spin-s));
 const k=r.dt/(r.top.uprightTau+r.dt),want=scale(cross(u,UP),r.top.uprightRate);
 f.body.setAngvel(vec(add(scale(u,spin),add(perp,scale(sub(want,perp),k)))),true);
}
const name=p=>p.mount==='core'?'核心':p.item.name.replace(/（.*?）/g,'');
const ACTIONS=['dash','block'];
function aiProfile(p){
 if(p===null)return null;
 if(!p||p.version!==1||!['mang','wen','chang'].includes(p.id))throw Error('Unknown manual.aiProfiles version or id');
 const limits={think:[1/120,2],reactionDelay:[0,2],reactionJitter:[0,2],blockLead:[0,1]};
 for(const [key,[min,max]]of Object.entries(limits))if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw Error(`Invalid ai profile ${key}`);
 if(p.id==='wen'&&(!Number.isFinite(p.idleDashAfter)||p.idleDashAfter<1||p.idleDashAfter>60))throw Error('Invalid ai profile idleDashAfter');
 if(!Array.isArray(p.dashRange)||p.dashRange.length!==2||!p.dashRange.every(x=>Number.isFinite(x)&&x>=0&&x<=10)||p.dashRange[0]>=p.dashRange[1])throw Error('Invalid ai profile dashRange');
 return {version:1,id:p.id,think:p.think,reactionDelay:p.reactionDelay,reactionJitter:p.reactionJitter,dashRange:[...p.dashRange],blockLead:p.blockLead,...(p.id==='wen'&&{idleDashAfter:p.idleDashAfter})};
}
/**
 * One match, one fixed physics step at a time; simulateV3 runs it to the end. New, explicit schema; the V1 entry
 * and its world/rules stay untouched.
 * manual (手动模式): {sides:[a,b], inputs} with each side 'input' (presses from press() or, on a replay, from
 * inputs [{step,side,action}]) or 'ai' (simple seeded rules). A press is taken at the start of the next step and
 * recorded; charge, dash, shield and their recoil all run inside the step, so a replay of the same presses is
 * byte-identical. manual.blockTime, when set, is recorded with the accepted presses for replay.
 * Pass meta.feel and meta.feelRules when reproducing an opt-in bounce replay.
 * Pass meta.combat and meta.combatRules as well for an opt-in position replay.
 */
export async function createV3Match({fighters:definitions,mode='A',seed,manual=null,feel,feelRules,combat,combatRules}){
 if(!['A','B'].includes(mode))throw Error('mode must be A or B');if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 if(manual&&(!Array.isArray(manual.sides)||manual.sides.length!==2||!manual.sides.every(x=>x==='input'||x==='ai')))throw Error("manual.sides must be two of 'input' | 'ai'");
 if(manual?.aiSeeds!==undefined&&(!Array.isArray(manual.aiSeeds)||manual.aiSeeds.length!==2||!manual.aiSeeds.every(s=>Number.isInteger(s)&&s>=0&&s<=0xffffffff)))throw Error('manual.aiSeeds must be two uint32 values');
 if(manual?.aiProfiles!==undefined&&(!Array.isArray(manual.aiProfiles)||manual.aiProfiles.length!==2))throw Error('manual.aiProfiles must contain two profiles or null');
 const aiProfiles=manual?.aiProfiles===undefined?[null,null]:Array.from(manual.aiProfiles,aiProfile);
 if(aiProfiles.some((p,i)=>p&&manual.sides[i]!=='ai'))throw Error('An ai profile requires an ai side');
 for(const x of manual?.inputs??[])if(!Number.isInteger(x.step)||x.step<1||![0,1].includes(x.side)||manual.sides[x.side]!=='input'||!ACTIONS.includes(x.action))throw Error(`Bad manual input ${JSON.stringify(x)}`);
 const c=await loadCatalogRules(),r=await loadV3Rules();definitions.forEach(d=>validate(d,c,r));await ready();
 const impact=combat==='position'&&combatRules?.impactControls===true;
 const impactDashContacts=impact&&combatRules.impactDashContacts===true;
 const resolveMutualDashContact=impactDashContacts&&combatRules.resolveMutualDashContact===true;
 const refinedImpact=impactDashContacts&&combatRules.refinedImpact===true;
 const position=combat==='position'?structuredClone(combatRules):null;
 const guardTiming=refinedImpact?position.guardTiming:undefined;
 if(guardTiming!==undefined&&(!guardTiming||
  !['aiCharge','aiDashJitter','blockTime','blockCooldown','perfectTime','wenBlockLead','changBlockLead'].every(key=>Number.isFinite(guardTiming[key])&&guardTiming[key]>=0)||
  guardTiming.aiCharge<r.manual.chargeTime||guardTiming.perfectTime<=0||
  guardTiming.perfectTime>=guardTiming.blockTime||guardTiming.blockTime>=guardTiming.aiCharge||
  guardTiming.blockCooldown<=guardTiming.blockTime))throw Error('Invalid guard timing');
 if(impact)r.top.damageRamp=[];
 else if(definitions.some(d=>d.parts.some(p=>p.item.startsWith('fanshuo-'))))r.top.damageRamp=structuredClone(TRIAL_DAMAGE_RAMP);
 if(manual?.blockTime!==undefined){
  if(![.2,.25,.3].includes(manual.blockTime)&&!(impact&&manual.blockTime===IMPACT.blockTime)&&manual.blockTime!==guardTiming?.blockTime)throw Error('Invalid manual.blockTime');
  r.manual.blockTime=manual.blockTime;
 }
 if(impact)r.manual.blockTime=guardTiming?.blockTime??IMPACT.blockTime;
 if(guardTiming)r.manual.blockCooldown=guardTiming.blockCooldown;
 // Automatic play uses the same symmetric spawn, but carries no manual rules or actions.
 const {manual:manualRules,...autoRules}=r,M=manual?manualRules:null,steps=x=>Math.round(x/r.dt);
 const opening=refinedImpact?position.opening:undefined;
 if(opening!==undefined&&(!opening||!Number.isFinite(opening.gap)||opening.gap<r.initialGap||
  ![opening.rampSeconds,opening.aiDashAfter,opening.minAiDashTime??0].every(value=>Number.isFinite(value)&&value>=0)))throw Error('Invalid opening approach');
 const hpScale=impact?position.hpScale??1:1;
 const mangHpScale=refinedImpact?position.mangHpScale??1:1;
 if([hpScale,mangHpScale].some(value=>!Number.isFinite(value)||value<1))throw Error('Impact durability scales must be finite and at least 1');
 if(combat==='position'&&(!position||!['radiusTolerance','recoilBase','recoilLength','outBonus','rangeAttack','rangeHp'].every(k=>Number.isFinite(position[k])&&position[k]>=0)||position.rangeAttack>=2||position.rangeHp>=2))throw Error('combatRules must specify finite non-negative position rules with range multipliers below 2');
 if(position?.capHp!==undefined&&(!Number.isFinite(position.capHp)||position.capHp<=0))throw Error('capHp must be positive and finite');
 if(position?.roleMode!==undefined&&!['radius','inward','reach'].includes(position.roleMode))throw Error('Unknown position role mode');
 if(position?.roleMode==='inward'&&(!Number.isFinite(position.inwardWindow)||position.inwardWindow<=0||!Number.isFinite(position.inwardTolerance)||position.inwardTolerance<0))throw Error('Inward role rules require a positive window and non-negative tolerance');
 const coreMassImpact=position?.coreMassImpact;
 if(coreMassImpact!==undefined&&(!Number.isFinite(coreMassImpact)||coreMassImpact<0))throw Error('coreMassImpact must be finite and non-negative');
 const coreDamageScale=position?.coreDamageScale;
 if(coreDamageScale!==undefined&&(!Number.isFinite(coreDamageScale)||coreDamageScale<=0||coreDamageScale>1))throw Error('coreDamageScale must be in (0, 1]');
 const autoBDamageScale=position?.autoBDamageScale;
 if(autoBDamageScale!==undefined){
  if(!Number.isFinite(autoBDamageScale)||autoBDamageScale<=0||autoBDamageScale>1)
   throw Error('autoBDamageScale must be in (0, 1]');
  if(mode==='B'&&!manual)r.damageScale.B*=autoBDamageScale;
 }
 const coreFinishMultiplier=impact?undefined:position?.coreFinishMultiplier;
 if(coreFinishMultiplier!==undefined&&(!Number.isFinite(coreFinishMultiplier)||coreFinishMultiplier<1||coreFinishMultiplier>2))
  throw Error('coreFinishMultiplier must be in [1, 2]');
 const coreLoadout=position?.coreLoadout;
 if(coreLoadout!==undefined&&(!coreLoadout||
  !['mainShare','attackGain','durabilityGain'].every(k=>Number.isFinite(coreLoadout[k]))||
  coreLoadout.mainShare<=.5||coreLoadout.mainShare>1||coreLoadout.attackGain<=0||coreLoadout.attackGain>4||coreLoadout.durabilityGain<=0||coreLoadout.durabilityGain>4))
  throw Error('Invalid position core loadout');
 const bareCoreReceive=position?.bareCoreReceive;
 if(bareCoreReceive!==undefined&&(!coreLoadout||!Number.isFinite(bareCoreReceive)||bareCoreReceive<1||bareCoreReceive>2.5))
  throw Error('Bare core damage requires core loadout and a multiplier in [1, 2.5]');
 const weightFeel=position?.weightFeel;
 if(weightFeel!==undefined&&(!weightFeel||
  !['slenderMinLength','slenderMinRatio','lightMass','heavyMass','dashLoss','recenterLoss'].every(k=>Number.isFinite(weightFeel[k]))||
  weightFeel.slenderMinLength<=0||weightFeel.slenderMinRatio<=1||weightFeel.lightMass<=0||
  weightFeel.heavyMass<=weightFeel.lightMass||weightFeel.dashLoss<0||weightFeel.dashLoss>=1||
  weightFeel.recenterLoss<0||weightFeel.recenterLoss>=1||
  weightFeel.recenterBoost!==undefined&&(!Number.isFinite(weightFeel.recenterBoost)||weightFeel.recenterBoost<0||weightFeel.recenterBoost>=1)))throw Error('Invalid position weight feel');
 const resistance=position?.broadHeavyResistance;
 if(resistance!==undefined&&(typeof resistance!=='boolean'||resistance&&(!weightFeel||!coreLoadout)))
  throw Error('Broad heavy resistance requires position weight and core loadout rules');
 const planar=position?.lockCorePlane===true,aimLock=position?.dashAimLockTime,weakHitFloor=position?.weakHitFloor??.08;
 if(position?.lockCorePlane!==undefined&&typeof position.lockCorePlane!=='boolean')throw Error('lockCorePlane must be boolean');
 const planeOverlapCorrectionCap=position?.planeOverlapCorrectionCap;
 if(planeOverlapCorrectionCap!==undefined&&(!planar||!Number.isFinite(planeOverlapCorrectionCap)||planeOverlapCorrectionCap<=0))
  throw Error('planeOverlapCorrectionCap must be positive and requires lockCorePlane');
 if(aimLock!==undefined&&(!Number.isFinite(aimLock)||aimLock<=0||aimLock>=manualRules.chargeTime))throw Error('dashAimLockTime must be within the charge');
 if(!Number.isFinite(weakHitFloor)||weakHitFloor<0||weakHitFloor>1)throw Error('weakHitFloor must be in [0, 1]');
 const ceramicShards=position?.ceramicShards===true;
 if(ceramicShards&&(!planar||!M))throw Error('Ceramic shards require planar combat with manual controls');
 const bounce=feel==='bounce'||position?structuredClone(feelRules??BOUNCE):null;
 if(bounce&&[bounce.attraction,bounce.thrust,bounce.recoilSpeed].some(v=>!Number.isFinite(v)||v<0))throw Error('feelRules must have non-negative finite attraction, thrust and recoilSpeed');
 // A separate seeded global half turn shares the engine's Float32 axis bias without changing player identities.
 const openingHalfTurn=random(seed^0xd1b54a35)()>=.5;
 const aiSeeds=manual?.aiSeeds??[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0],aiRoll=aiSeeds.map(random);
 const dashCooldownRoll=guardTiming&&aiSeeds.map(s=>random(s^0x85ebca6b));
 const perfectGuardSteps=guardTiming&&Math.floor(guardTiming.perfectTime/r.dt+1e-8);
 const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=r.dt;
 let fs,extents,initial,events,frames,diagnostics,scrapeEpisodes,record,closeContactRun,critRoll;
 let t=0,step=0,done=false,result=null,winner=null,reason='timeout',lastSeen=-Infinity,lastDamage=-Infinity,lastRecoil=-Infinity,contactRunSteps=0,contactRunStart=0;
 // Legacy matches use the original opening even if the first contact comes from a dash.
 const weightLoad=f=>weightFeel&&(impact||lastRecoil!==-Infinity)
  ?Math.max(0,Math.min(1,(f.mass-weightFeel.lightMass)/(weightFeel.heavyMass-weightFeel.lightMass))):0;
 const dashScale=f=>impact?1:1-weightLoad(f)*(weightFeel?.dashLoss??0);
 const chargeTime=i=>impact&&i===0?IMPACT.playerCharge:guardTiming&&manual.sides[i]==='ai'?guardTiming.aiCharge:M.chargeTime;
 const stunned=f=>impact&&f.ctl.stunUntil>=step;
 // A free straight lunge uses the same per-tick cap, acceleration and
 // damping as Rapier. Contact can end it earlier.
 let dashReach;
 if(aimLock!==undefined&&M){
  let speed=M.dashSpeed;
  dashReach=0;
  for(let i=0;i<steps(M.dashTime);i++){
   speed=(Math.min(speed,M.dashSpeedLimit)+M.dashThrust*r.dt)/(1+r.linearDamping*r.dt);
   dashReach+=speed*r.dt;
  }
 }
 try{
 buildArena(world,r);critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn,position,hpScale*(aiProfiles[i]?.id==='mang'?mangHpScale:1)));
 extents=fs.map(f=>sweepRadius(f,r));const distance=openingDistance(extents,r,opening);
 fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*(openingHalfTurn?-1:1)*distance/2,y:0,z:0},true));world.propagateModifiedBodyPositionsToColliders();
 initial=fs.map(f=>({definition:f.definition,sweepRadius:sweepRadius(f,r),...fighterFrame(f)}));events=[{t:0,type:'start'}];frames=[];diagnostics={maxResidualPenetration:0,maxGeometricPenetration:0,maxPositionCorrection:0,correctionSteps:0,zoneDamage:0,skippedSlowContacts:0};
 scrapeEpisodes=[];
 closeContactRun=()=>{const duration=contactRunSteps*r.dt;if(duration>=.1-1e-8)scrapeEpisodes.push({start:contactRunStart,end:contactRunStart+duration,duration});contactRunSteps=0;};
 record=()=>frames.push({t,fighters:fs.map(fighterFrame)});record();
 }catch(e){world.free();throw e;}
 // ---- manual play state (steps, not seconds) ----
 const queued=[[],[]],inputs=[],scripted=new Map();
 if(M){for(const f of fs)f.ctl={dashReady:0,blockReady:0,chargeUntil:-1,dashUntil:-1,shieldUntil:-1,blockPressStep:null,blockResolved:true,dashPressStep:null,lockedDir:null,pendingAi:null,stunUntil:-1,dashLockedUntil:0};for(const x of manual.inputs??[]){const k=`${x.step}|${x.side}`;scripted.set(k,[...(scripted.get(k)??[]),x.action]);}}
 const charging=f=>f.ctl.chargeUntil>=step,dashing=f=>f.ctl.dashUntil>=step,shielded=f=>f.ctl.shieldUntil>=step;
 const wenCanDash=i=>{const k=fs[i].ctl;return t<=k.counterUntil||step-(k.dashPressStep??0)>=steps(aiProfiles[i].idleDashAfter);};
 function tryPress(i,action,source,decisionStep){
  const f=fs[i],k=f.ctl;
  if(stunned(f))return;
  const press={t,type:'press',side:i,action,source,...(source==='ai'&&{decisionStep,reactionSteps:step-decisionStep})};
  if(action==='dash'){
   if(step<Math.max(k.dashReady,k.dashLockedUntil)||charging(f)||dashing(f))return;
   const windup=chargeTime(i);
   const jitter=guardTiming&&source==='ai'&&aiProfiles[i]?.id!=='wen'
    ?Math.floor(dashCooldownRoll[i]()*(steps(guardTiming.aiDashJitter)+1)):0;
   k.lockedDir=flat(arr(f.body.translation()),arr(fs[1-i].body.translation()));
   k.dashPressStep=step;
   k.chargeUntil=step+steps(windup)-1;
   k.dashReady=step+steps(M.dashCooldown)+jitter;
   k.aimUntil=t+windup;
   k.aimReach=dashReach===undefined?undefined:dashReach*dashScale(f);
   events.push(press,{t,type:'dash',phase:'charge',side:i,until:k.aimUntil,pressStep:step,lockedDir:k.lockedDir,
    ...(k.aimReach!==undefined&&{reach:k.aimReach}),
    ...(guardTiming&&i===1&&source==='ai'&&{blockReadyIn:Math.max(0,fs[0].ctl.blockReady-step)*r.dt})});
  }else{
   if(step<k.blockReady)return;
   k.shieldUntil=step+steps(M.blockTime)-1;
   k.blockReady=step+steps(M.blockCooldown);
   k.blockPressStep=step;
   k.blockResolved=false;
   events.push(press,{t,type:'block',side:i,until:t+M.blockTime,pressStep:step,windowSteps:steps(M.blockTime)});
  }
  if(manual.sides[i]==='input')inputs.push({step,side:i,action});
 }
 function blockResult(i,outcome,hit={}){
  const k=fs[i].ctl;
  if(k.blockResolved)return;
  k.blockResolved=true;
  const emptyPlayerGuard=impact&&!refinedImpact&&i===0&&outcome==='empty';
  if(emptyPlayerGuard)k.dashLockedUntil=step+steps(IMPACT.emptyGuardDashLock);
  events.push({t,type:'blockResult',side:i,outcome,pressStep:k.blockPressStep,resolvedStep:step,...hit,
   ...(emptyPlayerGuard&&{dashLockedUntil:k.dashLockedUntil*r.dt})});
 }
 /** Estimate contact from visible poses and velocities only; never advance a private future world. */
 function think(i){
  const me=fs[i],foe=fs[1-i],a=arr(me.body.translation()),b=arr(foe.body.translation()),n=flat(a,b),dist=hyp(b[0]-a[0],b[2]-a[2]),gap=dist-sweepRadius(me,r)-sweepRadius(foe,r),va=arr(me.body.linvel()),vb=arr(foe.body.linvel());
  if(stunned(me))return null;
  const profile=aiProfiles[i],tuning=profile??M.ai;
  if(profile?.id==='mang')return step>=me.ctl.dashReady&&!charging(me)&&!dashing(me)&&dist>=tuning.dashRange[0]&&dist<=tuning.dashRange[1]?'dash':null;
  const closing=dot(sub(va,vb),n),eta=closing>0?Math.max(0,gap)/closing:Infinity;
  const blockLead=guardTiming&&profile?.id==='wen'?guardTiming.wenBlockLead:
   guardTiming&&profile?.id==='chang'?guardTiming.changBlockLead:tuning.blockLead;
  if(step>=me.ctl.blockReady&&closing>0&&eta<=blockLead&&t-lastSeen>r.episodeSeparation)return 'block';
  if(profile?.id==='wen'&&!wenCanDash(i))return null;
  // Keep the AI's pursuit decision; the longer cue only changes when it launches.
  const windup=guardTiming&&i===1?M.chargeTime:chargeTime(i),future=sub(add(b,scale(vb,windup)),add(a,scale(va,windup))),futureN=flat([0,0,0],future);
  if(step>=me.ctl.dashReady&&!charging(me)&&!dashing(me)&&dist>=tuning.dashRange[0]&&dist<=tuning.dashRange[1]&&gap>0&&eta>windup*.7&&dot(n,futureN)>=M.dashAlignment&&t-lastRecoil>=r.recoilPause)return 'dash';
  return null;
 }
 function aiActions(i){
  const k=fs[i].ctl,profile=aiProfiles[i],tuning=profile??M.ai;
  if(profile?.id==='wen'){
   k.counterUntil??=-Infinity;
   for(let n=k.observedEvents??0;n<events.length;n++){const e=events[n];if(e.type==='dash'&&e.phase==='end'&&e.side===1-i)k.counterUntil=Math.max(k.counterUntil,e.t+2.4);if(e.type==='blockResult'&&e.side===i&&e.outcome==='perfect')k.counterUntil=Math.max(k.counterUntil,e.t+.8);}
   k.observedEvents=events.length;
  }
  if(k.pendingAi===null&&(step-1)%steps(tuning.think)===0){
   const action=think(i);
   // Give the player time to try the controls, even after an early contact.
   const earlyDash=action==='dash'&&(t<(opening?.minAiDashTime??0)||
    (lastSeen===-Infinity&&t<(opening?.aiDashAfter??0)));
   if(action&&!earlyDash)k.pendingAi={action,decisionStep:step,at:step+steps(profile?.reactionDelay??0)+Math.floor(aiRoll[i]()*(steps(tuning.reactionJitter)+1))};
  }
  if(k.pendingAi&&k.pendingAi.at<=step){const action=k.pendingAi;k.pendingAi=null;if(profile?.id!=='wen'||action.action!=='dash'||wenCanDash(i))return [action];}
  return [];
 }
 function manualStep(){
  for(let i=0;i<2;i++){
   const f=fs[i],k=f.ctl;
   if(impact&&k.dashUntil===step-1)k.stunUntil=Math.max(k.stunUntil,step+steps(IMPACT.heavyMissStun*weightLoad(f))-1);
   if(impact&&k.shieldUntil<step)blockResult(i,'empty');
   if(Math.max(k.dashReady,k.dashLockedUntil)===step)events.push({t,type:'ready',side:i,action:'dash'});
   if(k.blockReady===step)events.push({t,type:'ready',side:i,action:'block'});
   if(!impact&&k.shieldUntil<step)blockResult(i,'empty');
  }
  // Both decisions read the same pre-input state, including on the first step.
  const wants=fs.map((f,i)=>manual.sides[i]==='ai'?aiActions(i):[...(scripted.get(`${step}|${i}`)??[]),...queued[i].splice(0)].map(action=>({action})));
  for(let i=0;i<2;i++){
   for(const {action,decisionStep}of wants[i])tryPress(i,action,manual.sides[i],decisionStep);
  }
  fs.forEach((f,i)=>{
   const k=f.ctl;
   if(aimLock!==undefined&&charging(f)&&step>k.dashPressStep){
    const lockSteps=impact&&i===0?IMPACT.playerAimLockSteps:steps(aimLock);
    const tracking=step<=k.chargeUntil+1-lockSteps,reach=dashReach*dashScale(f);
    if(tracking){
     const target=flat(arr(f.body.translation()),arr(fs[1-i].body.translation()));
     k.lockedDir=impact?horizontalUnit(add(k.lockedDir,scale(sub(target,k.lockedDir),1-IMPACT.heavyTurnLoss*weightLoad(f)))):target;
    }
    if(tracking||reach!==k.aimReach){
     k.aimReach=reach;
     events.push({t,type:'dashAim',side:i,lockedDir:k.lockedDir,reach,until:k.aimUntil,pressStep:k.dashPressStep});
    }
   }
   if(k.chargeUntil===step-1){const dir=k.lockedDir,v=arr(f.body.linvel());
    const speed=M.dashSpeed*dashScale(f);
    f.ctl.dashUntil=step+steps(M.dashTime)-1;f.body.setLinvel(vec([dir[0]*speed,v[1],dir[2]*speed]),true);events.push({t,type:'dash',phase:'go',side:i,dir,lockedDir:dir,pressStep:f.ctl.dashPressStep});}
   else if(k.dashUntil===step-1)events.push({t,type:'dash',phase:'end',side:i,outcome:'miss',quality:'miss',alignment:null,pressStep:k.dashPressStep});
  });
 }
 function deflect(defender,point,perfect,damageApplied){
  const attacker=1-defender,guard=fs[defender].ctl,other=fs[attacker].ctl;
  const stunUntil=t+IMPACT.stun;
  other.stunUntil=step+steps(IMPACT.stun)-1;
  other.pendingAi=null;
  for(const side of [defender,attacker]){
   const top=fs[side];
   if(!charging(top))continue;
   events.push({t,type:'dash',phase:'end',side,outcome:'interrupted',quality:'interrupted',pressStep:top.ctl.dashPressStep});
   top.ctl.chargeUntil=-1;
  }
  guard.shieldUntil=step;
  guard.dashLockedUntil=0;
  guard.dashReady=Math.min(guard.dashReady,step+1);
  if(guardTiming)guard.blockReady=step+1;
  blockResult(defender,'perfect',{point,attacker,damageApplied,deflected:true,perfect,stunUntil});
 }
 function advance(){
  if(done)return;
  step++;t=step*r.dt;
  if(M)manualStep();
  const motion=bounce&&(impact||lastRecoil!==-Infinity)?bounce:r;
  const openingScale=opening?.rampSeconds&&lastSeen===-Infinity
   ?Math.min(1,t/opening.rampSeconds):1;
  fs.forEach((f,i)=>{
   const p=arr(planar?f.body.translation():f.body.worldCom()),delta=sub(arr(planar?fs[1-i].body.translation():fs[1-i].body.worldCom()),p),dist=length(delta),n=dist>1e-6?scale(delta,1/dist):[0,0,0],isStunned=M&&stunned(f),pursuit=isStunned||t-lastRecoil<r.recoilPause?0:1,v=arr(f.body.linvel());
   // Pull to the centre (stronger out of the spin plane), pursue the opponent, and, while pursuing,
   // bleed off velocity across the line between them so the pair cannot orbit without touching.
   const across=sub(v,scale(n,dot(v,n)));
   const load=weightLoad(f),dashSpeedScale=dashScale(f);
   const turn=impact?1-IMPACT.heavyTurnLoss*load:1;
   // Leave the initial rebound impulse intact. After separation, a light assembly
   // can turn inward sooner, while a heavy assembly keeps drifting outward.
   const agile=weightFeel?.recenterBoost&&lastRecoil!==-Infinity
    ?(1-load)*Math.min(1,(t-lastRecoil)/r.recoilPause)*weightFeel.recenterBoost:0;
   const attraction=motion.attraction*(1-load*(weightFeel?.recenterLoss??0)+agile);
   let acceleration=add(scale(p,-attraction),scale(n,motion.thrust*pursuit*turn));
   if(openingScale<1)acceleration=scale(acceleration,openingScale);
   acceleration=add(acceleration,[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);
   acceleration=add(acceleration,scale(across,-r.top.tangentialDamping*pursuit*turn));
   // Manual: winding up holds still (brakes, no pursuit); the lunge flies at the other core, unpulled by the centre.
   // During the added part of the cue, continue approaching before the original wind-up brake.
   const braking=M&&charging(f)&&(!guardTiming||manual.sides[i]!=='ai'||f.ctl.chargeUntil-step<steps(M.chargeTime));
   if(braking)acceleration=add(add(scale(p,-r.attraction),scale(v,-M.chargeBrake)),[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);
   else if(M&&dashing(f)){const dir=f.ctl.lockedDir,sideways=sub(v,scale(dir,dot(v,dir)));acceleration=add(add(scale(dir,M.dashThrust*dashSpeedScale),scale(sideways,-r.top.tangentialDamping)),[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);}
   if(isStunned)acceleration=[0,0,0];
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);f.body.resetTorques(true);
   driveSpin(f,r);
   const limit=M&&dashing(f)?M.dashSpeedLimit*dashSpeedScale:r.speedLimit,velocity=arr(f.body.linvel()),speed=length(velocity);if(speed>limit)f.body.setLinvel(vec(scale(velocity,limit/speed)),true);
   f.before={velocity:arr(f.body.linvel()),angular:arr(f.body.angvel()),center:arr(f.body.worldCom()),core:arr(f.body.translation())};
  });
  world.step();
  if(planar)keepCoresOnPlane(world,fs);
  let ceramicHit;
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
   // Manual: a lunge that lands is its own blow (no damage or recoil cooldown); a shield takes most of it.
   const closes=impact&&M&&dot(sub(fs[0].before.velocity,fs[1].before.velocity),flat(fs[0].before.core,fs[1].before.core))>r.minimumClosingSpeed;
   // A wide spinning attachment can hit before the core is lined up. The
   // manifold normal measures the dash approach into that actual surface.
   const contactApproach=impactDashContacts?horizontalUnit(normal):null;
   const contactClosing=impactDashContacts?dot(sub(fs[0].before.velocity,fs[1].before.velocity),contactApproach):0;
   const onSurface=impactDashContacts&&M&&contactClosing>=IMPACT.contactMinSpeed
    ?fs.map((f,i)=>dashing(f)&&dot(f.ctl.lockedDir,contactApproach)*(i===0?1:-1)>=IMPACT.contactMinAlignment):null;
   const canDeflect=impact&&M&&impulse>=r.minimumImpulse&&(newEpisode||closes||onSurface?.some(Boolean));
   const heldShield=canDeflect?fs.map(f=>shielded(f)&&!f.ctl.blockResolved):null;
   // A regular bump can meet a shield without using up the window.
   const guards=refinedImpact?heldShield?.map((held,i)=>held&&Boolean(onSurface?.[1-i])):heldShield;
   const tightGuards=guardTiming&&guards?.map((held,i)=>held&&step-fs[i].ctl.blockPressStep>perfectGuardSteps);
   const deflections=tightGuards?guards.map((held,i)=>held&&!tightGuards[i]):guards;
   const hasGuardContact=guards?.some(Boolean),hasDeflection=deflections?.some(Boolean);
   const lunge=M&&impulse>=r.minimumImpulse?[0,1].filter(i=>dashing(fs[i])&&(newEpisode||hasGuardContact||onSurface?.[i])):[];
   const shield=M?(impact?heldShield??[false,false]:fs.map(shielded)):null;
   const alignment=lunge.map(i=>{const a=fs[i].before,b=fs[1-i].before,n=flat(a.core,b.core);return {side:i,value:length(n)>0?dot(fs[i].ctl.lockedDir,n):null,closing:dot(sub(a.velocity,b.velocity),n)};});
   const fullLunge=alignment.filter(({side,value,closing})=>impactDashContacts
    ?onSurface?.[side]
    :value!==null&&value>=M.dashAlignment&&closing>0).map(x=>x.side);
   const strikes=hasGuardContact?fullLunge.filter(i=>!guards[i]):fullLunge;
   const dashContact=impactDashContacts&&lunge.length>0;
   const dashBlows=dashContact&&strikes.length===0?lunge.filter(i=>!guards?.[i]):strikes;
   const matchupMultipliers=[[left,right],[right,left]].map(([a,b])=>(c.matchups[a.item.tag]?.[b.item.tag]??1)>1?r.counterSpeedMultiplier:1);
   const pointVelocities=[contactVelocity(fs[0],point),contactVelocity(fs[1],rightPoint)],closingSpeed=dot(sub(pointVelocities[0],pointVelocities[1]),normal);
   let roles=topStrikeRoles({normal,velocities:pointVelocities,tipRatios:[tipRatio(left,point),tipRatio(right,rightPoint)],tipBonus:r.tipBonus,seed,masses:fs.map(f=>massWeight(f.mass,r.roleMassPower)),massPower:1,matchupMultipliers,minimumSpeed:r.minimumClosingSpeed},r.clashRelativeTolerance);
   let positionContact=null;
   if(position&&['inward','reach'].includes(position.roleMode)){
    const beforeTime=t-r.dt,prior=frames.findLast(frame=>frame.t<=beforeTime-(position.inwardWindow??.15))??frames[0];
    const radii=fs.map(f=>{const p=position.roleMode==='inward'?f.before.core:arr(f.body.translation());return hyp(p[0],p[2]);}),priorRadii=prior.fighters.map(f=>hyp(f.pos[0],f.pos[2]));
    const reach=position.roleMode==='reach'?fs.map(f=>sweepRadius(f,r)-r.core.radius):null,elapsed=Math.max(r.dt,beforeTime-prior.t);
    positionContact=alternativePositionRoles(roles,{mode:position.roleMode,radii,priorRadii,elapsed,reach},position.roleMode==='inward'?position.inwardTolerance:position.radiusTolerance,r.tipBonus);
   }else if(position){
    positionContact=positionStrikeRoles(roles,fs.map(f=>arr(f.body.translation())),position.radiusTolerance,r.tipBonus);
   }
   if(positionContact)roles=positionContact;
   const positionInfo=positionContact?{positionRadii:positionContact.positionRadii,positionAttacker:positionContact.attacker,positionClash:positionContact.clash,...(positionContact.positionMode&&{positionMode:positionContact.positionMode,positionValues:positionContact.positionValues}),dashOverridesPosition:Boolean(M&&dashBlows.length===1&&positionContact.attacker!==dashBlows[0])}:null;
   // A lunge is the blow: the lunging side strikes (which pieces touch is still the physics' call).
   if(M&&dashBlows.length===1)roles={...roles,clash:false,attacker:dashBlows[0],tipMultiplier:1+r.tipBonus*roles.tipRatios[dashBlows[0]]};
   // Simultaneous full lunges each deal dash damage. Two glances tied by the
   // contact roles each deal ordinary attack damage.
   else if(dashBlows.length===2&&dashContact&&(strikes.length===2||roles.attacker===null))roles={...roles,clash:true,attacker:null};
   if(newEpisode)events.push({t,type:'contact',point,rightPoint,normal,impulse,closingSpeed,parts:[left.id,right.id],items:[left.item.id,right.item.id],orients:[left.orient,right.orient],closingSpeeds:roles.normalSpeeds,attackScores:roles.scores,attacker:roles.attacker,clash:roles.clash,...positionInfo,pairCount:pairs.length});
   const shieldDamageApplied=[false,false];
   if((dashContact||newEpisode&&(t-lastDamage>=r.damageCooldown||M&&strikes.length>0))&&(roles.attacker!==null||roles.clash)&&impulse>=r.minimumImpulse){
    const pending=[];
    for(const [attacker,target,ap,tp,tpnt] of [[0,1,left,right,rightPoint],[1,0,right,left,point]]){
     const role=roles.clash||attacker===roles.attacker?'attack':'recoil',roleMultiplier=role==='attack'?1:r.recoilDamageFraction;
     const weakTouch=weakContact(tp,tpnt),roll=role==='attack'&&weakTouch?critRoll():null,weak=roll!==null&&weakCritical({contact:true,roll,chance:r.weakCritChance});
     // Accelerate a decisive one-sided finish while leaving even or partly disarmed fights alone.
     const targetBare=bareCoreReceive!==undefined&&tp.mount==='core'&&fs[target].parts.length>0&&fs[target].parts.every(p=>!p.alive);
     const opponent=fs[attacker];
     // Replays saved before the new preset still use the original core HP gate.
     const exposedCore=targetBare&&opponent.parts.length===2&&opponent.parts.every(p=>p.alive)&&
      (position.bareCoreByPartsOnly===true||opponent.core.hp>=opponent.core.maxHp*.75);
     // Higher durability changes time to break, leaving per-hit limits and triggers on the original scale.
     const damageReferenceHp=tp.baseHp;
     const d=tierDamage({mode,impulse,attacker:ap.item,target:tp.item,materials:c.materials,matchups:c.matchups,weak,tipMultiplier:role==='attack'?(roles.clash?1+r.tipBonus*roles.tipRatios[attacker]:roles.tipMultiplier):1,maxHp:damageReferenceHp,roleMultiplier,ramp:damageRamp(t,r.top.damageRamp),attackerOrient:ap.orient,targetOrient:tp.orient,rules:r,positionRules:position,coreMasses:coreMassImpact>0&&ap.mount==='core'&&tp.mount==='core'?[fs[attacker].mass,fs[target].mass]:undefined,
      coreLoadout:coreLoadout&&ap.mount==='core'&&tp.mount==='core'?{attack:fs[attacker].coreStats.attack,defense:exposedCore?Math.min(1,fs[target].coreStats.defense):fs[target].coreStats.defense}:undefined});
     // Broad heavy attachments resist weaker hits without gaining starting HP.
     if(tp.resistWeakHits){
      const attackScore=ap.mount==='core'?fs[attacker].coreStats.attackScore:ratingScores(ap.item).attack;
      const durability=ratingScores(tp.item).durability;
      if(attackScore<durability){
       d.weakHitResistance=Math.max(weakHitFloor,(attackScore/durability)**2);
       if(position.broadHeavyMidHit){
        const attackRatio=attackScore/durability;
        d.weakHitResistance=Math.max(weakHitFloor,attackRatio*attackRatio,Math.min(1,4*attackRatio-1.4));
       }
       d.damage*=d.weakHitResistance;
      }
     }
     // Shorten late fights through actual hits to the core. Opening and part durability stay the same.
     if(tp.mount==='core'&&coreFinishMultiplier!==undefined){
      const finish=damageRamp(t,[[34,1],[42,coreFinishMultiplier]]);
      d.damage*=finish;d.damageCap*=finish;
     }
     if(exposedCore){
      d.bareCoreReceive=bareCoreReceive;
      d.damageCap=Math.min(d.damageCap*bareCoreReceive,damageReferenceHp*.8);
      d.damage=Math.min(d.damage*bareCoreReceive,d.damageCap);
     }
     let flags=null;
     if(M){
      const dash=role==='attack'&&strikes.includes(attacker),shieldUp=shield[target],attempt=lunge.includes(attacker);
      const dashMultiplier=dash?(impact?IMPACT.dashDamage:M.dashDamage):1;
      d.damage*=shieldUp?M.blockDamage*(tightGuards?.[target]?dashMultiplier:1):dashMultiplier;
      flags={dash,shield:shieldUp,parry:dash&&shieldUp,dashAttempt:attempt,dashQuality:attempt?(fullLunge.includes(attacker)?'full':'glance'):null,alignment:alignment.find(x=>x.side===attacker)?.value??null};
     }
     const damage=Math.min(tp.hp,d.damage);
     pending.push({tp,event:{t,type:weak?'weak':'hit',attacker,target,part:ap.id,targetPart:tp.id,item:ap.item.id,targetItem:tp.item.id,mount:ap.mount,targetMount:tp.mount,orient:ap.orient,targetOrient:tp.orient,point:tpnt,impulse,closingSpeed,role,strikeAttacker:roles.attacker,clash:roles.clash,...positionInfo,normalSpeeds:roles.normalSpeeds,attackScores:roles.scores,masses:fs.map(f=>f.mass),matchupMultipliers,weakContact:weakTouch,weak,criticalRoll:roll,criticalChance:r.weakCritChance,roleMultiplier,tipMultiplier:role==='attack'?(roles.clash?1+r.tipBonus*roles.tipRatios[attacker]:roles.tipMultiplier):1,...d,damageBeforeHpClamp:d.damage,damage,...flags,caption:weak?`${name(ap)}撞中${name(tp)}弱点`:`${name(tp)}受撞，掉血了`}});
    }
    for(const {tp,event}of pending){
     tp.hp=Math.max(0,tp.hp-event.damage);
     event.hpAfter=tp.hp;
     events.push(event);
     if(M&&event.role==='attack'&&event.damage>0){
      if(event.shield)shieldDamageApplied[event.target]=true;
      else if(ceramicShards&&event.target===0&&event.damage>=tp.baseHp*.20&&!tp.shardsReleased&&
       /陶瓷|瓷器|瓷质|^瓷$/.test(tp.item.materialName?.trim()??''))ceramicHit=tp;
     }
    }
    lastDamage=t;
   }else if(newEpisode&&roles.attacker===null&&!roles.clash)diagnostics.skippedSlowContacts++;
   // A correctly timed guard is contact feedback, independent of the shared damage cooldown.
   if(hasGuardContact)for(let i=0;i<2;i++){
    const shieldPoint=i===0?point:rightPoint;
    if(deflections[i])deflect(i,shieldPoint,fullLunge.includes(1-i),shieldDamageApplied[i]);
    if(tightGuards?.[i]){
     fs[i].ctl.shieldUntil=step;
     blockResult(i,'tight',{point:shieldPoint,attacker:1-i,damageApplied:shieldDamageApplied[i]});
    }
   }
   if(!impact&&M&&newEpisode&&(roles.attacker!==null||roles.clash))for(let i=0;i<2;i++)if(shield[i]&&(roles.clash||i!==roles.attacker))blockResult(i,'perfect',{point:i===0?point:rightPoint,attacker:1-i,clash:roles.clash,damageApplied:shieldDamageApplied[i]});
   if((hasDeflection||t-lastRecoil>=r.contactCooldown||M&&fullLunge.length>0)&&impulse>=r.minimumImpulse){
    // Manual recoil scales: a shield barely moves; a lunge into a shield bounces hard; a landed lunge knocks the other back.
    const k=M?[0,1].map(i=>fullLunge.includes(i)?(shield[1-i]?M.bounceRecoil:1):shield[i]?M.blockRecoil:fullLunge.includes(1-i)?M.dashRecoil:1):null;
    const recoilSpeed=bounce&&(impact||!lunge.length&&!shield?.some(Boolean))?bounce.recoilSpeed:r.recoilSpeed;
    const partRecoil=position?[left,right].map(p=>partRecoilFactor(p,position)):null;
    const contactNormal=planar?planeNormal(normal,fs):normal;
    const centerNormal=impact?flat(fs[0].before.core,fs[1].before.core):null;
    const recoilNormal=centerNormal?.some(Boolean)?centerNormal:contactNormal;
    const before=fs.map(f=>arr(f.body.linvel()));
    const launchSpeed=refinedImpact
     ?Math.min(IMPACT.launchLimit,IMPACT.launchSpeed+IMPACT.launchGain*Math.max(0,contactClosing-IMPACT.contactMinSpeed))
     :IMPACT.launchSpeed;
    fs.forEach((f,i)=>{
     const sign=i===0?-1:1,partScale=partRecoil?.[i]??1;
     if(impact){
      const away=scale(recoilNormal,sign),speed=dot(before[i],away);
      const launched=deflections?.[1-i]||!shield?.[i]&&strikes.includes(1-i);
      const outgoing=launched?launchSpeed
       :Math.min(IMPACT.passiveSpeedLimit,Math.max(0,speed)+recoilSpeed*(deflections?.[i]?M.blockRecoil:1)*partScale);
      f.body.applyImpulse(vec(scale(away,f.mass*(outgoing-speed))),true);
     }else{
      const magnitude=M?sign*f.mass*recoilSpeed*k[i]*partScale:sign*f.mass*recoilSpeed*partScale;
      f.body.applyImpulse(vec(scale(recoilNormal,magnitude)),true);
     }
    });
    events.push({t,type:'recoil',normal:recoilNormal,impulse,velocityBefore:before,velocityAfter:fs.map(f=>arr(f.body.linvel())),recoilSpeed,...(partRecoil&&{partRecoil}),...(M&&!impact&&{recoilScale:k})});lastRecoil=t;
   }
   if(impulse>=r.minimumImpulse)lastSeen=t;
   // A resolved dash contact also ends an active dash on the receiving side.
   const endedDashes=resolveMutualDashContact&&dashContact?[0,1].filter(i=>dashing(fs[i])):lunge;
   for(const i of endedDashes){
    const f=fs[i],full=fullLunge.includes(i);
    const blocked=impact?Boolean(guards?.[1-i]):full&&(roles.clash||i===roles.attacker)&&shield[1-i]&&events.some(e=>e.t===t&&e.attacker===i&&e.parry&&e.damage>0);
    const outcome=blocked?'blocked':guards?.[i]||!lunge.includes(i)?'interrupted':'hit';
    const quality=outcome==='hit'?(full?'full':'glance'):outcome;
    const targetPoint=i===0?rightPoint:point;
    f.ctl.dashUntil=-1;
    events.push({t,type:'dash',phase:'end',side:i,outcome,quality,alignment:alignment.find(x=>x.side===i)?.value??null,...(impactDashContacts&&{contactClosing}),pressStep:f.ctl.dashPressStep,point:targetPoint});
    if(blocked&&(!impact||full)&&!tightGuards?.[1-i])events.push({t,type:'parry',attacker:i,target:1-i,point:targetPoint});
   }
  }
  if(ceramicHit){
   // Release once per attachment, including when no opposing attachment is in range.
   ceramicHit.shardsReleased=true;
   const point=arr(ceramicHit.collider.translation());
   let nearest=null;
   for(const target of fs[1].parts){
    if(!target.alive||target.hp<=0)continue;
    const distance=length(sub(point,arr(target.collider.projectPoint(vec(point),true).point)));
    if(distance<=.75&&(!nearest||distance<nearest.distance))nearest={target,distance};
   }
   const target=nearest?.target;
   const damage=target?Math.min(14,target.baseHp*.30,target.hp):0;
   if(target)target.hp-=damage;
   events.push({t,type:'archetype',archetype:'brittle',side:0,part:ceramicHit.id,item:ceramicHit.item.id,sourceHpAfter:ceramicHit.hp,
    target:target?1:null,targetPart:target?.id??null,targetItem:target?.item.id??null,
    point,distance:nearest?.distance??null,damage,hpAfter:target?.hp??null});
  }
  for(let i=0;i<2;i++)for(const p of fs[i].parts)if(p.alive&&p.hp<=0){const detached=detachPart(world,fs[i],p);events.push({t,type:'break',target:i,targetPart:p.id,item:p.item.id,mount:p.mount,orient:p.orient,...detached,caption:`${name(p)}碎了`});}
  if(planar)keepCoresOnPlane(world,fs);
  const projection=correctOverlap(world,fs,r,planar,planeOverlapCorrectionCap);diagnostics.maxResidualPenetration=Math.max(diagnostics.maxResidualPenetration,projection.remaining);diagnostics.maxGeometricPenetration=Math.max(diagnostics.maxGeometricPenetration,projection.before);diagnostics.maxPositionCorrection=Math.max(diagnostics.maxPositionCorrection,projection.correction);if(projection.correction>0)diagnostics.correctionSteps++;
  const dead=fs.map((f,i)=>f.core.hp<=0?i:null).filter(i=>i!==null);
  if(step%r.frameStride===0||dead.length)record();
  if(dead.length){
   // Both cores broke in this step: the one with less damage past zero wins; exactly equal is a draw. Never by side.
   const overkill=dead.length===2?[0,1].map(i=>events.filter(e=>e.t===t&&e.target===i&&e.targetPart==='core'&&e.damage>0).reduce((n,e)=>n+e.damageBeforeHpClamp-e.damage,0)):null;
   winner=overkill?doubleKoWinner(overkill):1-dead[0];reason=dead.length===2?'double-ko':'ko';
   events.push({t,type:'ko',target:winner===null?null:1-winner,targets:dead,winner,overkill,caption:winner===null?'两边核心同时碎了':overkill?`两颗核心同时碎，${winner===0?'右':'左'}方伤得更重`:`${winner===0?'左':'右'}方撞碎核心，赢了`});finish();}
  else if(step>=Math.round(r.maxDuration/r.dt))finish();
 }
 function finish(){
  done=true;
  try{
 if(M)for(let i=0;i<2;i++)blockResult(i,'empty');
 closeContactRun();diagnostics.scrapeEpisodes=scrapeEpisodes;diagnostics.scrapeCount=scrapeEpisodes.length;diagnostics.scrapeDuration=scrapeEpisodes.reduce((n,e)=>n+e.duration,0);diagnostics.maxScrapeDuration=Math.max(0,...scrapeEpisodes.map(e=>e.duration));
 if(frames.at(-1).t!==t)record();
 // Timeout facts are independent of hit history; no invented decisive blow or positional tie-break.
 const timeout=reason==='timeout'?timeoutVerdict(fs):null;if(timeout)winner=timeout.winner;
 const loser=winner===null?null:1-winner,kills=events.filter(e=>e.damage>0&&e.targetPart==='core'&&e.hpAfter===0);
 const cause=timeout?null:(loser!==null?kills.findLast(e=>e.target===loser):kills.at(-1))??null;
 const at=cause?.t??t,t0=Math.max(0,Math.min(t-2.5,at-1.5));
 const brokenBefore=cause&&loser!==null?events.filter(e=>e.type==='break'&&e.target===loser&&e.t<=cause.t).map(e=>({item:e.item,orient:e.orient,t:e.t})):[];
 const why=timeout?.why??(cause&&loser!==null?{attacker:cause.attacker,attackerPart:cause.part,attackerItem:cause.item==='__core'?null:cause.item,attackerOrient:cause.orient,target:cause.target,targetPart:cause.targetPart,targetItem:cause.targetItem==='__core'?null:cause.targetItem,targetOrient:cause.targetOrient,weak:cause.weak,role:cause.role,coreRatios:fs.map(f=>Math.max(0,f.core.hp)/f.core.maxHp),partsLeft:fs.map(f=>f.parts.filter(p=>p.alive).length),loserBroken:brokenBefore,loserPartsLeft:definitions[loser].parts.length-brokenBefore.length,...(M&&{dash:Boolean(cause.dash)})}:null);
 events.push({t,type:'result',winner,reason,why});
 result={meta:{schemaVersion:3,variant:'top',engine:'rapier3d-compat@0.21.0',seed,openingHalfTurn,mode,...(bounce&&{feel:position?'bounce':feel,feelRules:structuredClone(bounce)}),...(position&&{combat,combatRules:structuredClone(position)}),duration:t,winner,reason,initial,arenaRadius:r.arenaRadius,slots:structuredClone(r.top.slots),rules:M?r:autoRules,diagnostics,...(M&&{manual:{sides:[...manual.sides],blockTime:M.blockTime,aiSeeds:[...aiSeeds],inputs,...(aiProfiles.some(Boolean)&&{aiProfiles:structuredClone(aiProfiles)})}})},frames,events,decisive:{t0,t1:Math.min(t,t0+2.5),eventIndex:cause?events.indexOf(cause):null,finishType:reason==='timeout'?'timeout':'contact',why,caption:timeout?(winner===null?'时间到，双方剩血相同':`时间到，${winner===0?'左':'右'}方${why.criterion==='core-hp-ratio'?'核心剩血比例':'挂件剩血'}更多`):events.findLast(e=>e.type==='ko').caption}};
  }finally{world.free();}
 }
 return {
  rules:r,initial,frames,events,
  get t(){return t;},get step(){return step;},get done(){return done;},
  /** Queue a press for an 'input' side; it is taken at the start of the next step (or ignored on cooldown). */
  press(side,action){if(!M||manual.sides[side]!=='input'||!ACTIONS.includes(action))throw Error('press needs a manual input side and dash | block');if(!done)queued[side].push(action);},
  /** Button state for a side: seconds until ready, and what it is doing now. */
  control(side){const k=fs[side].ctl,f=fs[side];return {dashIn:Math.max(0,Math.max(k.dashReady,k.dashLockedUntil)-step)*r.dt,blockIn:Math.max(0,k.blockReady-step)*r.dt,charging:charging(f),dashing:dashing(f),shield:shielded(f),...(impact&&{stunIn:Math.max(0,k.stunUntil-step+1)*r.dt,dashLockIn:Math.max(0,k.dashLockedUntil-step)*r.dt})};},
  advance,
  result(){if(!done)throw Error('match not finished');return result;},
  /** Abandon a match before its end (frees the physics world). */
  free(){if(!done){done=true;world.free();}}
 };
}
export async function simulateV3({fighters,mode='A',seed,onProgress,manual=null,feel,feelRules,combat,combatRules}){
 const m=await createV3Match({fighters,mode,seed,manual,feel,feelRules,combat,combatRules});
 try{
  // Optional cooperative yield for a page; it never touches the world, so results are unchanged.
  while(!m.done){if(onProgress&&(m.step+1)%300===0)await onProgress((m.step+1)*m.rules.dt);m.advance();}
 }catch(e){m.free();throw e;}
 return m.result();
}
