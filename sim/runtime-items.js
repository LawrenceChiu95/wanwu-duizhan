import {rateItem} from './item-rating.js';

// JSON comparison ignores key order, but never drops undefined/non-finite fields.
export function itemSignature(value) {
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(itemSignature).join(',')+']';
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+itemSignature(value[k])).join(',')+'}';
 throw Error('Runtime item must contain JSON data only');
}
export function validateRuntimeItem(item,catalog){
 const bad=()=>{throw Error(`Invalid runtime item: ${item?.id??'missing id'}`);};
 const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>finite(n)&&n>0;
 const vector=a=>Array.isArray(a)&&a.length===3&&a.every(finite);
 if(!item||Object.getPrototypeOf(item)!==Object.prototype||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(item.id)||typeof item.name!=='string'||!item.name.trim()||typeof item.glb!=='string'||!item.glb||item.scale!==1)bad();
 if(!Object.hasOwn(catalog.materials,item.material)||typeof item.category!=='string'||!catalog.items.some(i=>i.category===item.category)||!catalog.items.some(i=>i.tag===item.tag)||!['intact','worn','damaged','unknown'].includes(item.condition))bad();
 if(!positive(item.mass)||!positive(item.volume)||!vector(item.bounds?.min)||!vector(item.bounds?.max)||!item.bounds.max.every((n,i)=>n>item.bounds.min[i]))bad();
 if(!Array.isArray(item.hull)||item.hull.length<4||item.hull.length>64||!item.hull.every(vector))bad();
 if(!item.hull.every(p=>p.every((v,i)=>v>=item.bounds.min[i]-1e-5&&v<=item.bounds.max[i]+1e-5)))bad();
 // Reject collapsed/planar hulls before Rapier tries to create a convex collider.
 const [o]=item.hull,d=item.hull.slice(1).map(p=>p.map((v,i)=>v-o[i]));
 let solid=false;
 for(let a=0;a<d.length&&!solid;a++)for(let b=a+1;b<d.length&&!solid;b++)for(let e=b+1;e<d.length;e++){
  const x=d[a],y=d[b],z=d[e],volume=x[0]*(y[1]*z[2]-y[2]*z[1])-x[1]*(y[0]*z[2]-y[2]*z[0])+x[2]*(y[0]*z[1]-y[1]*z[0]);
  if(Math.abs(volume)>1e-12){solid=true;break;}
 }
 if(!solid||!vector(item.weakPoint?.pos)||!positive(item.weakPoint?.radius)||!['hp','attack','defense'].every(k=>positive(item.stats?.[k])))bad();
 itemSignature(item);
 const calculated=rateItem(item,catalog.materials);
 if(itemSignature(item.rating)!==itemSignature(calculated))throw Error(`Runtime item rating mismatch: ${item.id}`);
 return structuredClone(item);
}
