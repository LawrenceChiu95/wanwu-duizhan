// Offline preparation writes per-object scores; web/src/rating.js ratingOf uses gradeFor/ratingScores here to derive display letters and grade.
export const GRADE_FLOORS = {S:75,A:60,B:45,C:30,D:0};
const toughness={metal:1,wood:.8,plastic:.65,cloth:1.4,rubber:.65};
const conditions={unknown:[1,1],intact:[1,1],worn:[.95,.9],damaged:[.6,.5]};
const score=n=>Math.round(Math.max(0,Math.min(100,n)));
// comparisonBase entries replace historical catalog objects in the default offer. Photo-estimated items (photoPhysics:
// 凡朔's twelve in the trial) don't count either: the cap stays the historical 2 kg, not the trial chair's 2.5 (Elara f2f329df).
export function photoMassLimit(catalog){
 const replaced=new Set(catalog.items.map(i=>i.comparisonBase).filter(Boolean));
 return Math.max(...catalog.items.filter(i=>!replaced.has(i.id)&&!i.photoPhysics).map(i=>i.mass));
}
export function gradeFor(value){
 if(!Number.isFinite(value)||value<0||value>100)throw Error('Rating score must be 0–100');
 return Object.keys(GRADE_FLOORS).find(g=>value>=GRADE_FLOORS[g]);
}
/** Stored scores only; invalid or incomplete ratings must not acquire a fabricated specialization. */
export function ratingScores(item){
 const scores=item?.rating?.scores;
 return scores&&['attack','range','durability'].every(k=>Number.isFinite(scores[k])&&scores[k]>=0&&scores[k]<=100)?scores:null;
}
/** Photo estimates override only this new item's hardness; existing items keep their exact arithmetic. */
export function itemHardness(item,materials){
 if(item.photoPhysics!==undefined){
  const h=item.photoPhysics?.hardness;
  if(!Number.isFinite(h)||h<.05||h>1.2)throw Error('Invalid photo hardness');
  return h;
 }
 return materials[item.material].hardness;
}
export function rateItem(item,materials){
 const ext=item.bounds.max.map((v,i)=>v-item.bounds.min[i]),length=Math.max(...ext);
 const condition=item.condition??'unknown',factors=conditions[condition];
 if(!factors||!Object.hasOwn(toughness,item.material)||!materials[item.material]||!Number.isFinite(item.mass)||item.mass<=0||!ext.every(v=>Number.isFinite(v)&&v>0))throw Error(`Invalid rating inputs: ${item.id}`);
 const m=Math.sqrt(item.mass/2.5),h=itemHardness(item,materials)/1.2;
 const endurance=item.photoPhysics ? 1.4-.4*h : toughness[item.material];
 const scores={attack:score(100*m*h*factors[0]),range:score(100*(Math.round(length*1e6)/1e6)/.8),durability:score(100*Math.sqrt(m)*endurance*factors[1])};
 const letters=Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,gradeFor(v)]));
 const grade=gradeFor((scores.attack+scores.range+scores.durability)/3);
 // Stable per-item reveal revision: metadata/name/image-only changes do not reveal again.
 const version=`rating-v1:${Object.values(scores).join('-')}:${Object.values(GRADE_FLOORS).join('-')}`;
 return {version,scores,letters,grade};
}
