import RAPIER from '@dimforge/rapier3d-compat';
import {loadRules as loadCatalogRules, strikeRoles, weakCritical} from './index.js';
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
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const UP=[0,1,0];
export async function loadV3Rules(){
 rulesPromise??=(async()=>{const url=new URL('./v3-rules.json',import.meta.url);if(url.protocol==='file:'){const fs=await import('node:fs/promises');return JSON.parse(await fs.readFile(url,'utf8'));}const r=await fetch(url);if(!r.ok)throw Error(`v3 rules HTTP ${r.status}`);return r.json();})();
 return structuredClone(await rulesPromise);
}
export {loadCatalog} from './index.js';
function validate(def,c,r){
 if(!def||!Array.isArray(def.parts)||def.parts.length>2)throw Error('v3 requires a core sphere with zero, one or two attachments');
 const used=new Set(),items=new Set();
 for(const p of def.parts){if(!c.items.some(i=>i.id===p.item))throw Error(`Unknown item ${p.item}`);if(items.has(p.item))throw Error('Duplicate attachments are outside this prototype');items.add(p.item);if(!Object.hasOwn(r.top.slots,p.mount)||used.has(p.mount))throw Error('Each attachment needs a unique equator slot');used.add(p.mount);if(!r.top.orients.includes(p.orient))throw Error(`orient must be one of ${r.top.orients.join(', ')}`);}
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
 const d=slotDirection(r.top.slots[mount]),{long,thin}=itemAxes(item),cols=[null,null,null];
 if(orient==='out'){cols[long]=scale(d,r.top.outEnd[item.id]??1);cols[thin]=UP;}else{cols[long]=UP;cols[thin]=d;}
 const m=3-long-thin;cols[m]=cross(cols[(m+1)%3],cols[(m+2)%3]);
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
/** The same per-object scores the library displays drive combat; total rarity adds no hidden bonus. */
export function itemCombat(item,r){
 if(item.id==='__core')return {hp:r.core.hp,power:1,attack:r.core.attack,defense:r.core.defense};
 const {attack,durability}=item.rating.scores,k=r.top.itemStats;
 return {hp:r.attachmentHp*(k.hpBase+k.hpScale*durability),power:k.powerBase+k.powerScale*attack,attack:k.attackBase+k.attackScale*attack,defense:k.defenseBase+k.defenseScale*durability};
}
function buildFighter(world,def,index,c,r,openingHalfTurn){
 const spin=r.top.spinRate*r.top.spinDirections[index];
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false).setLinearDamping(r.linearDamping).setAngularDamping(r.angularDamping));
 const item={id:'__core',name:'核心',tag:'core',material:r.core.material,stats:{attack:r.core.attack,defense:r.core.defense},bounds:{min:[-r.core.radius,-r.core.radius,-r.core.radius],max:[r.core.radius,r.core.radius,r.core.radius]}};
 const collider=world.createCollider(RAPIER.ColliderDesc.ball(r.core.radius).setMass(r.core.mass).setRestitution(.7).setFriction(.12),body);
 const core={id:'core',item,mount:'core',orient:'core',collider,maxHp:r.core.hp,hp:r.core.hp,alive:true};
 const parts=def.parts.map((p,i)=>{
  const item=c.items.find(x=>x.id===p.item),{offset,quat:q}=mountTransform(item,p.mount,p.orient,r),d=RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));if(!d)throw Error(`Invalid hull ${item.id}`);
  const collider=world.createCollider(d.setMass(item.mass).setTranslation(...offset).setRotation(quat(q)).setRestitution(c.materials[item.material].restitution).setFriction(.12),body);
  return {id:`part-${i}`,item,mount:p.mount,orient:p.orient,offset,localQuat:q,collider,maxHp:itemCombat(item,r).hp,hp:itemCombat(item,r).hp,alive:true};
 });
 body.recomputeMassPropertiesFromColliders();
 // Opposite sides face each other by a half turn, without reflecting handed geometry.
 const q=index===(openingHalfTurn?1:0)?[0,0,0,1]:[0,1,0,0];body.setRotation(quat(q),true);body.setAngvel(vec(scale(rotate(q,UP),spin)),true);
 return {body,core,parts,spin,mass:body.mass(),inertia:spinInertia(body),definition:structuredClone(def)};
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
function contactVelocity(f,point){return add(f.before.velocity,cross(f.before.angular,sub(point,f.before.center)));}
function tipRatio(p,point){if(p.mount==='core')return 0;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation()))),radius=hyp(...p.item.bounds.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(p.item.bounds.min[i]))));return Math.max(0,Math.min(1,(length(local)/radius-.65)/.35));}
function weakContact(p,point){if(p.mount==='core')return false;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation())));return length(sub(local,p.item.weakPoint.pos))<=p.item.weakPoint.radius;}
export function tierDamage({mode,impulse,attacker,target,materials,matchups,weak=false,tipMultiplier=1,maxHp,roleMultiplier=1,ramp=1,attackerOrient='core',targetOrient='core',rules:r}){
 const attack=itemCombat(attacker,r),defend=itemCombat(target,r);
 // Hardness rewards the striker; a soft target no longer raises the damage tier just for being soft.
 const hardness=Math.sqrt(materials[attacker.material].hardness/r.top.referenceHardness),matchup=matchups[attacker.tag]?.[target.tag]??1;
 const score=(mode==='A'?impulse:Math.max(0,attack.attack*matchup-defend.defense))*hardness*tipMultiplier;
 const tier=r.tierThresholds[mode].filter(threshold=>score>=threshold).length;
 // Per-object power and mounting trade-off apply before the existing per-hit cap.
 const attackMultiplier=r.top?.orientPower?.[attackerOrient]??1,receiveMultiplier=(r.top?.orientReceive?.[targetOrient]??1)*(targetOrient==='hug'?(r.top.softHugReceive[target.material]??1):1);
 const rawDamage=r.tierDamage[tier]*r.damageScale[mode]*(weak?2:1)*ramp*attack.power*attackMultiplier*receiveMultiplier,damageCap=maxHp*(weak?r.weakCritMaxFraction:r.maxHitFraction);
 return {score,tier,hardness,matchup,itemPower:attack.power,attackMultiplier,receiveMultiplier,rawDamage,damageCap,damage:Math.min(rawDamage,damageCap)*roleMultiplier};
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
function correctOverlap(world,fs,r){
 let before=0,remaining=0,correction=0;
 for(let i=0;i<=r.overlapIterations;i++){
  let deepest=null;
  for(const p of active(fs[0]))for(const q of active(fs[1])){const hit=p.collider.contactCollider(q.collider,0);if(hit&&hit.distance<0&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
  remaining=deepest?-deepest.distance:0;if(i===0)before=remaining;
  const budget=r.top.maxCorrectionPerStep-correction;
  if(remaining<=r.overlapTolerance||i===r.overlapIterations||budget<=1e-9)break;
  const amount=Math.min(remaining+.0001,budget),total=fs[0].mass+fs[1].mass,delta=scale(arr(deepest.normal1),amount);
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
/**
 * One match, one fixed physics step at a time; simulateV3 runs it to the end. New, explicit schema; the V1 entry
 * and its world/rules stay untouched.
 * manual (手动模式): {sides:[a,b], inputs} with each side 'input' (presses from press() or, on a replay, from
 * inputs [{step,side,action}]) or 'ai' (simple seeded rules). A press is taken at the start of the next step and
 * recorded; charge, dash, shield and their recoil all run inside the step, so a replay of the same presses is
 * byte-identical. manual.blockTime, when set, is recorded with the accepted presses for replay.
 */
export async function createV3Match({fighters:definitions,mode='A',seed,manual=null}){
 if(!['A','B'].includes(mode))throw Error('mode must be A or B');if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 if(manual&&(!Array.isArray(manual.sides)||manual.sides.length!==2||!manual.sides.every(x=>x==='input'||x==='ai')))throw Error("manual.sides must be two of 'input' | 'ai'");
 if(manual?.aiSeeds!==undefined&&(!Array.isArray(manual.aiSeeds)||manual.aiSeeds.length!==2||!manual.aiSeeds.every(s=>Number.isInteger(s)&&s>=0&&s<=0xffffffff)))throw Error('manual.aiSeeds must be two uint32 values');
 for(const x of manual?.inputs??[])if(!Number.isInteger(x.step)||x.step<1||![0,1].includes(x.side)||manual.sides[x.side]!=='input'||!ACTIONS.includes(x.action))throw Error(`Bad manual input ${JSON.stringify(x)}`);
 const c=await loadCatalogRules(),r=await loadV3Rules();definitions.forEach(d=>validate(d,c,r));await ready();
 if(manual?.blockTime!==undefined){if(![.2,.25,.3].includes(manual.blockTime))throw Error('manual.blockTime must be 0.2, 0.25 or 0.3');r.manual.blockTime=manual.blockTime;}
 // Automatic play has the same symmetric opening, but carries no manual rules or actions.
 const {manual:manualRules,...autoRules}=r,M=manual?manualRules:null,steps=x=>Math.round(x/r.dt);
 // A separate seeded global half turn shares the engine's Float32 axis bias without changing player identities.
 const openingHalfTurn=random(seed^0xd1b54a35)()>=.5;
 const aiSeeds=manual?.aiSeeds??[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0],aiRoll=aiSeeds.map(random);
 const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=r.dt;
 let fs,extents,initial,events,frames,diagnostics,scrapeEpisodes,record,closeContactRun,critRoll;
 let t=0,step=0,done=false,result=null,winner=null,reason='timeout',lastSeen=-Infinity,lastDamage=-Infinity,lastRecoil=-Infinity,contactRunSteps=0,contactRunStart=0;
 try{
 buildArena(world,r);critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn));
 extents=fs.map(f=>sweepRadius(f,r));const distance=extents[0]+extents[1]+r.initialGap;
 fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*(openingHalfTurn?-1:1)*distance/2,y:0,z:0},true));world.propagateModifiedBodyPositionsToColliders();
 initial=fs.map(f=>({definition:f.definition,sweepRadius:sweepRadius(f,r),...fighterFrame(f)}));events=[{t:0,type:'start'}];frames=[];diagnostics={maxResidualPenetration:0,maxGeometricPenetration:0,maxPositionCorrection:0,correctionSteps:0,zoneDamage:0,skippedSlowContacts:0};
 scrapeEpisodes=[];
 closeContactRun=()=>{const duration=contactRunSteps*r.dt;if(duration>=.1-1e-8)scrapeEpisodes.push({start:contactRunStart,end:contactRunStart+duration,duration});contactRunSteps=0;};
 record=()=>frames.push({t,fighters:fs.map(fighterFrame)});record();
 }catch(e){world.free();throw e;}
 // ---- manual play state (steps, not seconds) ----
 const queued=[[],[]],inputs=[],scripted=new Map();
 if(M){for(const f of fs)f.ctl={dashReady:0,blockReady:0,chargeUntil:-1,dashUntil:-1,shieldUntil:-1,blockPressStep:null,blockResolved:true,dashPressStep:null,lockedDir:null,pendingAi:null};for(const x of manual.inputs??[]){const k=`${x.step}|${x.side}`;scripted.set(k,[...(scripted.get(k)??[]),x.action]);}}
 const charging=f=>f.ctl.chargeUntil>=step,dashing=f=>f.ctl.dashUntil>=step,shielded=f=>f.ctl.shieldUntil>=step;
 const flat=(a,b)=>{const d=[b[0]-a[0],0,b[2]-a[2]],n=hyp(d[0],d[2]);return n>1e-6?[d[0]/n,0,d[2]/n]:[0,0,0];};
 function tryPress(i,action,source,decisionStep){
  const f=fs[i],k=f.ctl;
  if(action==='dash'){if(step<k.dashReady||charging(f)||dashing(f))return;k.lockedDir=flat(arr(f.body.translation()),arr(fs[1-i].body.translation()));k.dashPressStep=step;k.chargeUntil=step+steps(M.chargeTime)-1;k.dashReady=step+steps(M.dashCooldown);events.push({t,type:'press',side:i,action,source,...(source==='ai'&&{decisionStep,reactionSteps:step-decisionStep})});events.push({t,type:'dash',phase:'charge',side:i,until:t+M.chargeTime,pressStep:step,lockedDir:k.lockedDir});}
  else{if(step<k.blockReady)return;k.shieldUntil=step+steps(M.blockTime)-1;k.blockReady=step+steps(M.blockCooldown);k.blockPressStep=step;k.blockResolved=false;events.push({t,type:'press',side:i,action,source,...(source==='ai'&&{decisionStep,reactionSteps:step-decisionStep})});events.push({t,type:'block',side:i,until:t+M.blockTime,pressStep:step,windowSteps:steps(M.blockTime)});}
  if(manual.sides[i]==='input')inputs.push({step,side:i,action});
 }
 function blockResult(i,outcome,hit={}){const k=fs[i].ctl;if(k.blockResolved)return;k.blockResolved=true;events.push({t,type:'blockResult',side:i,outcome,pressStep:k.blockPressStep,resolvedStep:step,...hit});}
 /** Estimate contact from visible poses and velocities only; never advance a private future world. */
 function think(i){
  const me=fs[i],foe=fs[1-i],a=arr(me.body.translation()),b=arr(foe.body.translation()),n=flat(a,b),dist=hyp(b[0]-a[0],b[2]-a[2]),gap=dist-sweepRadius(me,r)-sweepRadius(foe,r),va=arr(me.body.linvel()),vb=arr(foe.body.linvel());
  const closing=dot(sub(va,vb),n),eta=closing>0?Math.max(0,gap)/closing:Infinity;
  if(step>=me.ctl.blockReady&&closing>0&&eta<=M.ai.blockLead&&t-lastSeen>r.episodeSeparation)return 'block';
  const future=sub(add(b,scale(vb,M.chargeTime)),add(a,scale(va,M.chargeTime))),futureN=flat([0,0,0],future);
  if(step>=me.ctl.dashReady&&!charging(me)&&!dashing(me)&&dist>=M.ai.dashRange[0]&&dist<=M.ai.dashRange[1]&&gap>0&&eta>M.chargeTime*.7&&dot(n,futureN)>=M.dashAlignment&&t-lastRecoil>=r.recoilPause)return 'dash';
  return null;
 }
 function aiActions(i){
  const k=fs[i].ctl;
  if(k.pendingAi===null&&(step-1)%steps(M.ai.think)===0){const action=think(i);if(action)k.pendingAi={action,decisionStep:step,at:step+Math.floor(aiRoll[i]()*(steps(M.ai.reactionJitter)+1))};}
  if(k.pendingAi&&k.pendingAi.at<=step){const action=k.pendingAi;k.pendingAi=null;return [action];}
  return [];
 }
 function manualStep(){
  for(let i=0;i<2;i++){
   const k=fs[i].ctl;for(const action of ACTIONS)if(k[`${action}Ready`]===step)events.push({t,type:'ready',side:i,action});
   if(k.shieldUntil<step)blockResult(i,'empty');
  }
  // Both decisions read the same pre-input state, including on the first step.
  const wants=fs.map((f,i)=>manual.sides[i]==='ai'?aiActions(i):[...(scripted.get(`${step}|${i}`)??[]),...queued[i].splice(0)].map(action=>({action})));
  for(let i=0;i<2;i++){
   for(const {action,decisionStep}of wants[i])tryPress(i,action,manual.sides[i],decisionStep);
  }
  fs.forEach((f,i)=>{if(f.ctl.chargeUntil===step-1){const dir=f.ctl.lockedDir,v=arr(f.body.linvel());f.ctl.dashUntil=step+steps(M.dashTime)-1;f.body.setLinvel(vec([dir[0]*M.dashSpeed,v[1],dir[2]*M.dashSpeed]),true);events.push({t,type:'dash',phase:'go',side:i,dir,lockedDir:dir,pressStep:f.ctl.dashPressStep});}
   else if(f.ctl.dashUntil===step-1)events.push({t,type:'dash',phase:'end',side:i,outcome:'miss',quality:'miss',alignment:null,pressStep:f.ctl.dashPressStep});});
 }
 function advance(){
  if(done)return;
  step++;t=step*r.dt;
  if(M)manualStep();
  fs.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),delta=sub(arr(fs[1-i].body.worldCom()),p),dist=length(delta),n=dist>1e-6?scale(delta,1/dist):[0,0,0],pursuit=t-lastRecoil<r.recoilPause?0:1,v=arr(f.body.linvel());
   // Pull to the centre (stronger out of the spin plane), pursue the opponent, and, while pursuing,
   // bleed off velocity across the line between them so the pair cannot orbit without touching.
   const across=sub(v,scale(n,dot(v,n)));
   let acceleration=add(scale(p,-r.attraction),scale(n,r.thrust*pursuit));
   acceleration=add(acceleration,[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);
   acceleration=add(acceleration,scale(across,-r.top.tangentialDamping*pursuit));
   // Manual: winding up holds still (brakes, no pursuit); the lunge flies at the other core, unpulled by the centre.
   if(M&&charging(f))acceleration=add(add(scale(p,-r.attraction),scale(v,-M.chargeBrake)),[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);
   else if(M&&dashing(f)){const dir=f.ctl.lockedDir,sideways=sub(v,scale(dir,dot(v,dir)));acceleration=add(add(scale(dir,M.dashThrust),scale(sideways,-r.top.tangentialDamping)),[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);}
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);f.body.resetTorques(true);
   driveSpin(f,r);
   const limit=M&&dashing(f)?M.dashSpeedLimit:r.speedLimit,velocity=arr(f.body.linvel()),speed=length(velocity);if(speed>limit)f.body.setLinvel(vec(scale(velocity,limit/speed)),true);
   f.before={velocity:arr(f.body.linvel()),angular:arr(f.body.angvel()),center:arr(f.body.worldCom()),core:arr(f.body.translation())};
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
   // Manual: a lunge that lands is its own blow (no damage or recoil cooldown); a shield takes most of it.
   const lunge=M&&newEpisode&&impulse>=r.minimumImpulse?[0,1].filter(i=>dashing(fs[i])):[],shield=M?fs.map(shielded):null;
   const alignment=lunge.map(i=>{const a=fs[i].before,b=fs[1-i].before,n=flat(a.core,b.core);return {side:i,value:length(n)>0?dot(fs[i].ctl.lockedDir,n):null,closing:dot(sub(a.velocity,b.velocity),n)};});
   const fullLunge=alignment.filter(x=>x.value!==null&&x.value>=M.dashAlignment&&x.closing>0).map(x=>x.side);
   const matchupMultipliers=[[left,right],[right,left]].map(([a,b])=>(c.matchups[a.item.tag]?.[b.item.tag]??1)>1?r.counterSpeedMultiplier:1);
   const pointVelocities=[contactVelocity(fs[0],point),contactVelocity(fs[1],rightPoint)],closingSpeed=dot(sub(pointVelocities[0],pointVelocities[1]),normal);
   let roles=topStrikeRoles({normal,velocities:pointVelocities,tipRatios:[tipRatio(left,point),tipRatio(right,rightPoint)],tipBonus:r.tipBonus,seed,masses:fs.map(f=>massWeight(f.mass,r.roleMassPower)),massPower:1,matchupMultipliers,minimumSpeed:r.minimumClosingSpeed},r.clashRelativeTolerance);
   // A lunge is the blow: the lunging side strikes (which pieces touch is still the physics' call).
   if(M&&fullLunge.length===1)roles={...roles,clash:false,attacker:fullLunge[0],tipMultiplier:1+r.tipBonus*roles.tipRatios[fullLunge[0]]};
   if(newEpisode)events.push({t,type:'contact',point,rightPoint,normal,impulse,closingSpeed,parts:[left.id,right.id],items:[left.item.id,right.item.id],orients:[left.orient,right.orient],closingSpeeds:roles.normalSpeeds,attackScores:roles.scores,attacker:roles.attacker,clash:roles.clash,pairCount:pairs.length});
   const shieldDamageApplied=[false,false];
   if(newEpisode&&(roles.attacker!==null||roles.clash)&&impulse>=r.minimumImpulse&&(t-lastDamage>=r.damageCooldown||M&&fullLunge.length>0)){
    const pending=[];
    for(const [attacker,target,ap,tp,tpnt] of [[0,1,left,right,rightPoint],[1,0,right,left,point]]){
     const role=roles.clash||attacker===roles.attacker?'attack':'recoil',roleMultiplier=role==='attack'?1:r.recoilDamageFraction;
     const weakTouch=weakContact(tp,tpnt),roll=role==='attack'&&weakTouch?critRoll():null,weak=roll!==null&&weakCritical({contact:true,roll,chance:r.weakCritChance});
     const d=tierDamage({mode,impulse,attacker:ap.item,target:tp.item,materials:c.materials,matchups:c.matchups,weak,tipMultiplier:role==='attack'?(roles.clash?1+r.tipBonus*roles.tipRatios[attacker]:roles.tipMultiplier):1,maxHp:tp.maxHp,roleMultiplier,ramp:damageRamp(t,r.top.damageRamp),attackerOrient:ap.orient,targetOrient:tp.orient,rules:r});
     let flags=null;
     if(M){const dash=role==='attack'&&fullLunge.includes(attacker),shieldUp=shield[target],attempt=lunge.includes(attacker);d.damage*=(shieldUp?M.blockDamage:dash?M.dashDamage:1);flags={dash,shield:shieldUp,parry:dash&&shieldUp,dashAttempt:attempt,dashQuality:attempt?(fullLunge.includes(attacker)?'full':'glance'):null,alignment:alignment.find(x=>x.side===attacker)?.value??null};}
     const damage=Math.min(tp.hp,d.damage);
     pending.push({tp,event:{t,type:weak?'weak':'hit',attacker,target,part:ap.id,targetPart:tp.id,item:ap.item.id,targetItem:tp.item.id,mount:ap.mount,targetMount:tp.mount,orient:ap.orient,targetOrient:tp.orient,point:tpnt,impulse,closingSpeed,role,strikeAttacker:roles.attacker,clash:roles.clash,normalSpeeds:roles.normalSpeeds,attackScores:roles.scores,masses:fs.map(f=>f.mass),matchupMultipliers,weakContact:weakTouch,weak,criticalRoll:roll,criticalChance:r.weakCritChance,roleMultiplier,tipMultiplier:role==='attack'?(roles.clash?1+r.tipBonus*roles.tipRatios[attacker]:roles.tipMultiplier):1,...d,damageBeforeHpClamp:d.damage,damage,...flags,caption:weak?`${name(ap)}撞中${name(tp)}弱点`:`${name(tp)}受撞，掉血了`}});
    }
    for(const {tp,event}of pending){tp.hp=Math.max(0,tp.hp-event.damage);event.hpAfter=tp.hp;events.push(event);if(M&&event.role==='attack'&&event.shield&&event.damage>0)shieldDamageApplied[event.target]=true;}
    lastDamage=t;
   }else if(newEpisode&&roles.attacker===null&&!roles.clash)diagnostics.skippedSlowContacts++;
   // A correctly timed guard is contact feedback, independent of the shared damage cooldown.
   if(M&&newEpisode&&(roles.attacker!==null||roles.clash))for(let i=0;i<2;i++)if(shield[i]&&(roles.clash||i!==roles.attacker))blockResult(i,'perfect',{point:i===0?point:rightPoint,attacker:1-i,clash:roles.clash,damageApplied:shieldDamageApplied[i]});
   if((t-lastRecoil>=r.contactCooldown||M&&fullLunge.length>0)&&impulse>=r.minimumImpulse){
    // Manual recoil scales: a shield barely moves; a lunge into a shield bounces hard; a landed lunge knocks the other back.
    const k=M?[0,1].map(i=>fullLunge.includes(i)?(shield[1-i]?M.bounceRecoil:1):shield[i]?M.blockRecoil:fullLunge.includes(1-i)?M.dashRecoil:1):null;
    const before=fs.map(f=>arr(f.body.linvel()));fs.forEach((f,i)=>f.body.applyImpulse(vec(scale(normal,M?(i===0?-1:1)*f.mass*r.recoilSpeed*k[i]:(i===0?-1:1)*f.mass*r.recoilSpeed)),true));
    events.push({t,type:'recoil',normal,impulse,velocityBefore:before,velocityAfter:fs.map(f=>arr(f.body.linvel())),recoilSpeed:r.recoilSpeed,...(M&&{recoilScale:k})});lastRecoil=t;
   }
   if(impulse>=r.minimumImpulse)lastSeen=t;
   // A lunge ends at its first new contact: landed, or bounced off a shield (parry).
   for(const i of lunge){const f=fs[i],full=fullLunge.includes(i),blocked=full&&(roles.clash||i===roles.attacker)&&shield[1-i]&&events.some(e=>e.t===t&&e.attacker===i&&e.parry&&e.damage>0),quality=blocked?'blocked':full?'full':'glance';f.ctl.dashUntil=-1;events.push({t,type:'dash',phase:'end',side:i,outcome:blocked?'blocked':'hit',quality,alignment:alignment.find(x=>x.side===i).value,pressStep:f.ctl.dashPressStep,point:i===0?rightPoint:point});if(blocked)events.push({t,type:'parry',attacker:i,target:1-i,point:i===0?rightPoint:point});}
  }
  for(let i=0;i<2;i++)for(const p of fs[i].parts)if(p.alive&&p.hp<=0){const detached=detachPart(world,fs[i],p);events.push({t,type:'break',target:i,targetPart:p.id,item:p.item.id,mount:p.mount,orient:p.orient,...detached,caption:`${name(p)}碎了`});}
  const projection=correctOverlap(world,fs,r);diagnostics.maxResidualPenetration=Math.max(diagnostics.maxResidualPenetration,projection.remaining);diagnostics.maxGeometricPenetration=Math.max(diagnostics.maxGeometricPenetration,projection.before);diagnostics.maxPositionCorrection=Math.max(diagnostics.maxPositionCorrection,projection.correction);if(projection.correction>0)diagnostics.correctionSteps++;
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
 const why=timeout?.why??(cause&&loser!==null?{attacker:cause.attacker,attackerPart:cause.part,attackerItem:cause.item==='__core'?null:cause.item,attackerOrient:cause.orient,target:cause.target,targetPart:cause.targetPart,targetItem:cause.targetItem==='__core'?null:cause.targetItem,targetOrient:cause.targetOrient,weak:cause.weak,loserBroken:brokenBefore,loserPartsLeft:definitions[loser].parts.length-brokenBefore.length,...(M&&{dash:Boolean(cause.dash)})}:null);
 events.push({t,type:'result',winner,reason,why});
 result={meta:{schemaVersion:3,variant:'top',engine:'rapier3d-compat@0.21.0',seed,openingHalfTurn,mode,duration:t,winner,reason,initial,arenaRadius:r.arenaRadius,slots:structuredClone(r.top.slots),rules:M?r:autoRules,diagnostics,...(M&&{manual:{sides:[...manual.sides],blockTime:M.blockTime,aiSeeds:[...aiSeeds],inputs}})},frames,events,decisive:{t0,t1:Math.min(t,t0+2.5),eventIndex:cause?events.indexOf(cause):null,finishType:reason==='timeout'?'timeout':'contact',why,caption:timeout?(winner===null?'时间到，双方剩血相同':`时间到，${winner===0?'左':'右'}方${why.criterion==='core-hp-ratio'?'核心剩血比例':'挂件剩血'}更多`):events.findLast(e=>e.type==='ko').caption}};
  }finally{world.free();}
 }
 return {
  rules:r,initial,frames,events,
  get t(){return t;},get step(){return step;},get done(){return done;},
  /** Queue a press for an 'input' side; it is taken at the start of the next step (or ignored on cooldown). */
  press(side,action){if(!M||manual.sides[side]!=='input'||!ACTIONS.includes(action))throw Error('press needs a manual input side and dash | block');if(!done)queued[side].push(action);},
  /** Button state for a side: seconds until ready, and what it is doing now. */
  control(side){const k=fs[side].ctl,f=fs[side];return {dashIn:Math.max(0,k.dashReady-step)*r.dt,blockIn:Math.max(0,k.blockReady-step)*r.dt,charging:charging(f),dashing:dashing(f),shield:shielded(f)};},
  advance,
  result(){if(!done)throw Error('match not finished');return result;},
  /** Abandon a match before its end (frees the physics world). */
  free(){if(!done){done=true;world.free();}}
 };
}
export async function simulateV3({fighters,mode='A',seed,onProgress,manual=null}){
 const m=await createV3Match({fighters,mode,seed,manual});
 try{
  // Optional cooperative yield for a page; it never touches the world, so results are unchanged.
  while(!m.done){if(onProgress&&(m.step+1)%300===0)await onProgress((m.step+1)*m.rules.dt);m.advance();}
 }catch(e){m.free();throw e;}
 return m.result();
}
