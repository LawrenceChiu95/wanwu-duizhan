// Keep the original score record for older clients and input-only replays.
export const GRADE_FLOORS = {S:75,A:60,B:45,C:30,D:0};
const toughness={metal:1,wood:.8,plastic:.65,cloth:1.4,rubber:.65};
const conditions={unknown:[1,1],intact:[1,1],worn:[.95,.9],damaged:[.6,.5]};
const photoRatingVersion='rating-v2';
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
export function ratingGrade(scores,version){
 const {attack,range,durability}=scores;
 return gradeFor(typeof version==='string'&&version.startsWith(photoRatingVersion+':')
  ? (38*attack+18*range+44*durability)/100
  : (attack+range+durability)/3);
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
function contactScores(item,m,factors,range){
 const {hasBladeOrPoint,impactHardness}=item.photoPhysics;
 if(typeof hasBladeOrPoint!=='boolean'||!Number.isFinite(impactHardness)||impactHardness<.05||impactHardness>1.2)throw Error('Invalid photo impact inputs');
 const soft=item.material==='cloth'||/泡沫|海绵/.test(item.materialName);
 const weight=Math.min(1,item.mass/2);
 const hardness=impactHardness/1.2;
 // A heavy solid object transfers force even through a softer coating.
 const contact=soft?hardness:hardness+(1-hardness)*.6*weight**2;
 const attack=score((100*m*contact+(hasBladeOrPoint?24:0))*factors[0]);
 // Cosmetic wear matters less than weight; broken parts still lose half their endurance.
 const wear=item.condition==='worn'?.98:factors[1];
 let durability=score(78*weight**.14*wear);
 const fragile=/陶瓷|瓷器|瓷质|玻璃/.test(item.materialName);
 if(fragile){
  const floor=GRADE_FLOORS[gradeFor(durability)];
  durability=Math.min(score(durability*.8),floor===0?GRADE_FLOORS.C-1:floor-1);
 }else if(soft) durability=Math.min(score(durability+3*wear),GRADE_FLOORS.S-1);
 if(hasBladeOrPoint)durability=Math.min(durability,GRADE_FLOORS.A-1);
 return {attack,range,durability};
}
export function rateItem(item,materials){
 const ext=item.bounds.max.map((v,i)=>v-item.bounds.min[i]),length=Math.max(...ext);
 const condition=item.condition??'unknown',factors=conditions[condition];
 if(!factors||!Object.hasOwn(toughness,item.material)||!materials[item.material]||!Number.isFinite(item.mass)||item.mass<=0||!ext.every(v=>Number.isFinite(v)&&v>0))throw Error(`Invalid rating inputs: ${item.id}`);
 const m=Math.sqrt(item.mass/2.5),h=itemHardness(item,materials)/1.2;
 const endurance=item.photoPhysics ? 1.4-.4*h : toughness[item.material];
 const range=score(100*(Math.round(length*1e6)/1e6)/.8);
 const photoContact=item.photoPhysics&&('impactHardness' in item.photoPhysics||'hasBladeOrPoint' in item.photoPhysics);
 const scores=photoContact?contactScores(item,m,factors,range)
  :{attack:score(100*m*h*factors[0]),range,durability:score(100*Math.sqrt(m)*endurance*factors[1])};
 const letters=Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,gradeFor(v)]));
 // Stable per-item reveal revision: metadata/name/image-only changes do not reveal again.
 const version=`${photoContact?photoRatingVersion:'rating-v1'}:${Object.values(scores).join('-')}:${Object.values(GRADE_FLOORS).join('-')}`;
 return {version,scores,letters,grade:ratingGrade(scores,version)};
}

// Setting the entire table to 1 selects the letters-only rule on the exact original scores.
export const MATERIAL_DURABILITY = Object.freeze({metal:1.12,wood:1.04,plastic:.98,rubber:.94,cloth:.90,foam:.84,paper:.62,fragile:1});
const materialEnabled = Object.values(MATERIAL_DURABILITY).some(value => value !== 1);
export const CURRENT_RATING_VERSION = materialEnabled ? 'rating-v3' : 'rating-letters-v3';
const gradeLetters = Object.keys(GRADE_FLOORS);
const attackFloors = [75,52,38,20,0], rangeFloors = [80,60,50,30,0];
const durabilityFloors = materialEnabled ? [80,57,52,44,0] : [82,64,52,44,0];
const totalFloors = materialEnabled ? [84,62,54,46,0] : [84,67,56,51,0];
const gradeAt = (value, floors) => gradeLetters[floors.findIndex(floor => value >= floor)];

function materialDurability(item) {
 const name = item.materialName ?? '';
 const kind = /陶瓷|瓷器|瓷质|玻璃/.test(name) ? 'fragile'
  : /纸/.test(name) ? 'paper' : /泡沫|海绵/.test(name) ? 'foam' : item.material;
 const wear = ({worn:.98,damaged:.5})[item.condition] ?? 1;
 const base = 78 * Math.min(1, item.mass / 2)**.14 * wear;
 const weighted = score(base * MATERIAL_DURABILITY[kind]);
 const durability = kind === 'fragile'
  ? Math.min(score(weighted * .8), (GRADE_FLOORS[gradeFor(weighted)] || GRADE_FLOORS.C) - 1)
  : weighted;
 return item.photoPhysics.hasBladeOrPoint ? Math.min(durability, GRADE_FLOORS.A - 1) : durability;
}

// Keep attack and range from the exact version originally saved, including pre-contact photo records.
export function currentItemRating(item) {
 const original = ratingScores(item);
 if(!original)return null;
 const {attack, range, durability} = materialEnabled && item.photoPhysics
  ? {...original, durability:materialDurability(item)} : original;
 if(!Number.isFinite(durability))throw Error(`Invalid material durability: ${item.id}`);
 const second = Math.min(attack, durability), reach = Math.max(0, range - 40) / 15;
 const bonus = materialEnabled ? Math.min(3, Math.max(0, second - 40) / 10) + .75 * reach
  : Math.min(3, Math.max(0, second - 20) / 4) + reach;
 return {
  version:`${CURRENT_RATING_VERSION}:${attack}-${range}-${durability}`,
  scores:{attack,range,durability},
  letters:{attack:gradeAt(attack,attackFloors),range:gradeAt(range,rangeFloors),durability:gradeAt(durability,durabilityFloors)},
  grade:gradeAt(Math.max(attack,durability) + bonus,totalFloors)
 };
}

export function withCurrentRating(item) {
 return {...item, currentRating:currentItemRating(item)};
}
