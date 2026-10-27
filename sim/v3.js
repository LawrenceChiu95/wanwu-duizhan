import RAPIER from '@dimforge/rapier3d-compat';
import {loadRules as loadCatalogRules, strikeRoles, weakCritical} from './index.js';
import {add,sub,scale,length,vec,arr,quat,qarr,rotate,inverseRotate,random} from './math.js';
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
 const n=Math.hypot(...q);return q.map(v=>v/n);
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
 const angle=r.top.slots[mount]*Math.PI/180,d=[Math.sin(angle),0,Math.cos(angle)],{long,thin}=itemAxes(item),cols=[null,null,null];
 if(orient==='out'){cols[long]=scale(d,r.top.outEnd[item.id]??1);cols[thin]=UP;}else{cols[long]=UP;cols[thin]=d;}
 const m=3-long-thin;cols[m]=cross(cols[(m+1)%3],cols[(m+2)%3]);
 const q=basisQuat(...cols),nearest=Math.min(...item.hull.map(v=>dot(rotate(q,v),d)));
 return {offset:scale(d,r.core.radius-r.top.embed-nearest),quat:q,direction:d};
}
/** Body-frame extents of a mounted part (for drawing): slot angle, radial and height range of its hull. */
export function mountExtents(item,mount,orient,r){
 const {offset,quat:q}=mountTransform(item,mount,orient,r),pts=item.hull.map(v=>add(offset,rotate(q,v))),rad=pts.map(p=>Math.hypot(p[0],p[2])),ys=pts.map(p=>p[1]);
 return {offset,quat:q,theta:r.top.slots[mount]*Math.PI/180,r0:Math.min(...rad),r1:Math.max(...rad),y0:Math.min(...ys),y1:Math.max(...ys)};
}
const bodyPointVelocity=(body,point)=>add(arr(body.linvel()),cross(arr(body.angvel()),sub(point,arr(body.worldCom()))));
function partFrame(p){return {id:p.id,item:p.item.id==='__core'?null:p.item.id,mount:p.mount,orient:p.orient,pos:p.alive?arr(p.collider.translation()):p.brokenPose.pos,quat:p.alive?qarr(p.collider.rotation()):p.brokenPose.quat,hp:p.hp,maxHp:p.maxHp,alive:p.mount==='core'?p.hp>0:p.alive};}
function fighterFrame(f){return {pos:arr(f.body.translation()),quat:qarr(f.body.rotation()),hp:f.core.hp,maxHp:f.core.maxHp,core:partFrame(f.core),parts:f.parts.map(partFrame),velocity:arr(f.body.linvel()),angularVelocity:arr(f.body.angvel()),mass:f.mass,centerOfMass:arr(f.body.worldCom())};}
/** Moment of inertia about the body's spin axis (local +Y). */
function spinInertia(body){const I=arr(body.principalInertia()),local=inverseRotate(qarr(body.principalInertiaLocalFrame()),UP);return I[0]*local[0]*local[0]+I[1]*local[1]*local[1]+I[2]*local[2]*local[2];}
function buildFighter(world,def,index,rng,c,r){
 const tilt=[(rng()-.5)*.2,0,(rng()-.5)*.2],spin=r.top.spinRate*r.top.spinDirections[index];
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false).setLinearDamping(r.linearDamping).setAngularDamping(r.angularDamping));
 const item={id:'__core',name:'核心',tag:'core',material:r.core.material,stats:{attack:r.core.attack,defense:r.core.defense},bounds:{min:[-r.core.radius,-r.core.radius,-r.core.radius],max:[r.core.radius,r.core.radius,r.core.radius]}};
 const collider=world.createCollider(RAPIER.ColliderDesc.ball(r.core.radius).setMass(r.core.mass).setRestitution(.7).setFriction(.12),body);
 const core={id:'core',item,mount:'core',orient:'core',collider,maxHp:r.core.hp,hp:r.core.hp,alive:true};
 const parts=def.parts.map((p,i)=>{
  const item=c.items.find(x=>x.id===p.item),{offset,quat:q}=mountTransform(item,p.mount,p.orient,r),d=RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));if(!d)throw Error(`Invalid hull ${item.id}`);
  const collider=world.createCollider(d.setMass(item.mass).setTranslation(...offset).setRotation(quat(q)).setRestitution(c.materials[item.material].restitution).setFriction(.12),body);
  return {id:`part-${i}`,item,mount:p.mount,orient:p.orient,offset,localQuat:q,collider,maxHp:r.attachmentHp*(r.top.itemHp?.[item.id]??1),hp:r.attachmentHp*(r.top.itemHp?.[item.id]??1),alive:true};
 });
 body.recomputeMassPropertiesFromColliders();
 // Start upright (small seeded tilt), already spinning about the local up axis.
 const q=quatFromRotationVector(tilt);body.setRotation(quat(q),true);body.setAngvel(vec(scale(rotate(q,UP),spin)),true);
 return {body,core,parts,spin,mass:body.mass(),inertia:spinInertia(body),definition:structuredClone(def)};
}
function quatFromRotationVector(v){const a=length(v);if(a<1e-12)return [0,0,0,1];const s=Math.sin(a/2)/a;return [v[0]*s,v[1]*s,v[2]*s,Math.cos(a/2)];}
const active=f=>[f.core,...f.parts.filter(p=>p.alive)];
/** Radius the spinning top sweeps in its equator plane (core included). */
function sweepRadius(f,r){let extent=r.core.radius;for(const p of f.parts)for(const v of p.item.hull){const w=add(p.offset,rotate(p.localQuat,v));extent=Math.max(extent,Math.hypot(w[0],w[2]));}return extent;}
/** Removing a part preserves velocity at every surviving material point. */
export function detachPart(world,f,p){
 const pose={pos:arr(p.collider.translation()),quat:qarr(p.collider.rotation())},velocity=bodyPointVelocity(f.body,pose.pos),angularVelocity=arr(f.body.angvel()),oldCenter=arr(f.body.worldCom()),oldVelocity=arr(f.body.linvel()),massBefore=f.body.mass();
 p.alive=false;p.hp=0;p.brokenPose=pose;world.removeCollider(p.collider,true);f.body.recomputeMassPropertiesFromColliders();f.mass=f.body.mass();f.inertia=spinInertia(f.body);
 const newCenter=arr(f.body.worldCom()),newVelocity=add(oldVelocity,cross(angularVelocity,sub(newCenter,oldCenter)));
 f.body.setLinvel(vec(newVelocity),true);f.body.setAngvel(vec(angularVelocity),true);
 return {pose,velocity,angularVelocity,massBefore,massAfter:f.mass,oldCenter,newCenter,oldVelocity,newVelocity};
}
// mass^p for the strike-role score. Math.pow/** with exponents other than 0.5 and integers is not
// bit-identical across V8 versions (Node 22 vs Chrome 156 differ); exp and log are, so replays stay byte-identical.
const massWeight=(m,p)=>p===.5?Math.sqrt(m):Math.exp(p*Math.log(m));
function contactVelocity(f,point){return add(f.before.velocity,cross(f.before.angular,sub(point,f.before.center)));}
function tipRatio(p,point){if(p.mount==='core')return 0;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation()))),radius=Math.hypot(...p.item.bounds.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(p.item.bounds.min[i]))));return Math.max(0,Math.min(1,(length(local)/radius-.65)/.35));}
function weakContact(p,point){if(p.mount==='core')return false;const local=inverseRotate(qarr(p.collider.rotation()),sub(point,arr(p.collider.translation())));return length(sub(local,p.item.weakPoint.pos))<=p.item.weakPoint.radius;}
export function tierDamage({mode,impulse,attacker,target,materials,matchups,weak=false,tipMultiplier=1,maxHp,roleMultiplier=1,ramp=1,rules:r}){
 const hardness=Math.sqrt(materials[attacker.material].hardness/materials[target.material].hardness),matchup=matchups[attacker.tag]?.[target.tag]??1;
 const score=(mode==='A'?impulse:Math.max(0,attacker.stats.attack*matchup-target.stats.defense))*hardness*tipMultiplier;
 const tier=r.tierThresholds[mode].filter(threshold=>score>=threshold).length;
 // Per-item balance knob for the top variant (data, not physics): a light piece's real hit counts for a bit more.
 const rawDamage=r.tierDamage[tier]*r.damageScale[mode]*(weak?2:1)*ramp*(r.top?.itemPower?.[attacker.id]??1),damageCap=maxHp*(weak?r.weakCritMaxFraction:r.maxHitFraction);
 return {score,tier,hardness,matchup,rawDamage,damageCap,damage:Math.min(rawDamage,damageCap)*roleMultiplier};
}
/** Loose start, tight finish: real hits count for a little less early and more late (piecewise linear in time). Never damage without a hit. */
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
 const k=1-Math.exp(-r.dt/r.top.uprightTau),want=scale(cross(u,UP),r.top.uprightRate);
 f.body.setAngvel(vec(add(scale(u,spin),add(perp,scale(sub(want,perp),k)))),true);
}
const name=p=>p.mount==='core'?'核心':p.item.name.replace(/（.*?）/g,'');
/** New, explicit schema. V1 entry and its world/rules stay untouched. */
export async function simulateV3({fighters:definitions,mode='A',seed,onProgress}){
 if(!['A','B'].includes(mode))throw Error('mode must be A or B');if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seed must be a uint32');if(!Array.isArray(definitions)||definitions.length!==2)throw Error('Exactly two fighters required');
 const c=await loadCatalogRules(),r=await loadV3Rules();definitions.forEach(d=>validate(d,c,r));await ready();
 const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=r.dt;
 try{
 const rng=random(seed),critRng=random(seed^0x9e3779b9),fs=definitions.map((d,i)=>buildFighter(world,d,i,rng,c,r));
 const extents=fs.map(f=>sweepRadius(f,r)),distance=extents[0]+extents[1]+r.initialGap;
 fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*distance/2,y:(rng()-.5)*.08,z:(rng()-.5)*.08},true));world.propagateModifiedBodyPositionsToColliders();
 const initial=fs.map(f=>({definition:f.definition,sweepRadius:sweepRadius(f,r),...fighterFrame(f)})),events=[],frames=[],diagnostics={maxResidualPenetration:0,maxGeometricPenetration:0,maxPositionCorrection:0,correctionSteps:0,zoneDamage:0,skippedSlowContacts:0};
 let t=0,winner=null,reason='timeout',lastSeen=-Infinity,lastDamage=-Infinity,lastRecoil=-Infinity,lastStrike=null,contactRunSteps=0,contactRunStart=0;
 const scrapeEpisodes=[];
 const closeContactRun=()=>{const duration=contactRunSteps*r.dt;if(duration>=.1-1e-8)scrapeEpisodes.push({start:contactRunStart,end:contactRunStart+duration,duration});contactRunSteps=0;};
 const record=()=>frames.push({t,fighters:fs.map(fighterFrame)});record();
 for(let step=1;step<=Math.round(r.maxDuration/r.dt);step++){
  t=step*r.dt;
  // Optional cooperative yield for a page; it never touches the world, so results are unchanged.
  if(onProgress&&step%300===0)await onProgress(t);
  fs.forEach((f,i)=>{
   const p=arr(f.body.worldCom()),delta=sub(arr(fs[1-i].body.worldCom()),p),dist=length(delta),n=dist>1e-6?scale(delta,1/dist):[0,0,0],pursuit=t-lastRecoil<r.recoilPause?0:1,v=arr(f.body.linvel());
   // Pull to the centre (stronger out of the spin plane), pursue the opponent, and, while pursuing,
   // bleed off velocity across the line between them so the pair cannot orbit without touching.
   const across=sub(v,scale(n,dot(v,n)));
   let acceleration=add(scale(p,-r.attraction),scale(n,r.thrust*pursuit));
   acceleration=add(acceleration,[0,-r.top.planeAttraction*p[1]-r.top.planeDamping*v[1],0]);
   acceleration=add(acceleration,scale(across,-r.top.tangentialDamping*pursuit));
   f.body.resetForces(true);f.body.addForce(vec(scale(acceleration,f.mass)),true);f.body.resetTorques(true);
   driveSpin(f,r);
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
   const pointVelocities=[contactVelocity(fs[0],point),contactVelocity(fs[1],rightPoint)],closingSpeed=dot(sub(pointVelocities[0],pointVelocities[1]),normal);
   const roles=strikeRoles({normal,velocities:pointVelocities,tipRatios:[tipRatio(left,point),tipRatio(right,rightPoint)],tipBonus:r.tipBonus,seed,masses:fs.map(f=>massWeight(f.mass,r.roleMassPower)),massPower:1,matchupMultipliers,minimumSpeed:r.minimumClosingSpeed});
   if(newEpisode)events.push({t,type:'contact',point,rightPoint,normal,impulse,closingSpeed,parts:[left.id,right.id],items:[left.item.id,right.item.id],orients:[left.orient,right.orient],closingSpeeds:roles.normalSpeeds,attackScores:roles.scores,attacker:roles.attacker,pairCount:pairs.length});
   if(newEpisode&&roles.attacker!==null&&impulse>=r.minimumImpulse&&t-lastDamage>=r.damageCooldown){
    const pending=[];
    for(const [attacker,target,ap,tp,tpnt] of [[0,1,left,right,rightPoint],[1,0,right,left,point]]){
     const role=attacker===roles.attacker?'attack':'recoil',roleMultiplier=role==='attack'?1:r.recoilDamageFraction;
     const weakTouch=weakContact(tp,tpnt),roll=role==='attack'&&weakTouch?critRng():null,weak=roll!==null&&weakCritical({contact:true,roll,chance:r.weakCritChance});
     const d=tierDamage({mode,impulse,attacker:ap.item,target:tp.item,materials:c.materials,matchups:c.matchups,weak,tipMultiplier:role==='attack'?roles.tipMultiplier:1,maxHp:tp.maxHp,roleMultiplier,ramp:damageRamp(t,r.top.damageRamp),rules:r});
     const damage=Math.min(tp.hp,d.damage);
     pending.push({tp,event:{t,type:weak?'weak':'hit',attacker,target,part:ap.id,targetPart:tp.id,item:ap.item.id,targetItem:tp.item.id,mount:ap.mount,targetMount:tp.mount,orient:ap.orient,targetOrient:tp.orient,point:tpnt,impulse,closingSpeed,role,strikeAttacker:roles.attacker,normalSpeeds:roles.normalSpeeds,attackScores:roles.scores,masses:fs.map(f=>f.mass),matchupMultipliers,weakContact:weakTouch,weak,criticalRoll:roll,criticalChance:r.weakCritChance,roleMultiplier,tipMultiplier:role==='attack'?roles.tipMultiplier:1,...d,damageBeforeHpClamp:d.damage,damage,caption:weak?`${name(ap)}撞中${name(tp)}弱点`:`${name(tp)}受撞，掉血了`}});
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
  for(let i=0;i<2;i++)for(const p of fs[i].parts)if(p.alive&&p.hp<=0){const detached=detachPart(world,fs[i],p);events.push({t,type:'break',target:i,targetPart:p.id,item:p.item.id,mount:p.mount,orient:p.orient,...detached,caption:`${name(p)}碎了`});}
  const projection=correctOverlap(world,fs,r);diagnostics.maxResidualPenetration=Math.max(diagnostics.maxResidualPenetration,projection.remaining);diagnostics.maxGeometricPenetration=Math.max(diagnostics.maxGeometricPenetration,projection.before);diagnostics.maxPositionCorrection=Math.max(diagnostics.maxPositionCorrection,projection.correction);if(projection.correction>0)diagnostics.correctionSteps++;
  const dead=fs.map((f,i)=>f.core.hp<=0?i:null).filter(i=>i!==null);
  if(step%r.frameStride===0||dead.length)record();
  if(dead.length){winner=dead.length===2?lastStrike:1-dead[0];reason=dead.length===2?'double-ko':'ko';events.push({t,type:'ko',target:dead.length===2?null:dead[0],winner,caption:winner===null?'双方核心都碎了':`${winner===0?'左':'右'}方撞碎核心，赢了`});break;}
 }
 closeContactRun();diagnostics.scrapeEpisodes=scrapeEpisodes;diagnostics.scrapeCount=scrapeEpisodes.length;diagnostics.scrapeDuration=scrapeEpisodes.reduce((n,e)=>n+e.duration,0);diagnostics.maxScrapeDuration=Math.max(0,...scrapeEpisodes.map(e=>e.duration));
 if(frames.at(-1).t!==t)record();
 // No zone, attrition, ringout, or HP-percentage timeout win. Only core KO wins.
 const cause=events.findLast(e=>e.damage>0&&e.targetPart==='core'&&e.hpAfter===0)??events.filter(e=>e.damage>0&&e.role==='attack').sort((a,b)=>b.damage-a.damage)[0]??null;
 const at=cause?.t??t,t0=Math.max(0,Math.min(t-2.5,at-1.5));
 // Plain facts for the one-line reason: who struck with what, and what the loser still had on.
 const loser=cause?cause.target:null,brokenBefore=cause?events.filter(e=>e.type==='break'&&e.target===loser&&e.t<=cause.t).map(e=>({item:e.item,orient:e.orient,t:e.t})):[];
 const why=cause&&{attacker:cause.attacker,attackerPart:cause.part,attackerItem:cause.item==='__core'?null:cause.item,attackerOrient:cause.orient,target:cause.target,targetPart:cause.targetPart,targetItem:cause.targetItem==='__core'?null:cause.targetItem,targetOrient:cause.targetOrient,weak:cause.weak,loserBroken:brokenBefore,loserPartsLeft:definitions[loser].parts.length-brokenBefore.length};
 return {meta:{schemaVersion:3,variant:'top',engine:'rapier3d-compat@0.21.0',seed,mode,duration:t,winner,reason,initial,arenaRadius:r.arenaRadius,slots:structuredClone(r.top.slots),rules:r,diagnostics},frames,events,decisive:{t0,t1:Math.min(t,t0+2.5),eventIndex:cause?events.indexOf(cause):null,finishType:reason==='timeout'?'timeout':'contact',why,caption:reason==='timeout'?'时间到，双方核心还在':events.at(-1).caption}};
 }finally{world.free();}
}
