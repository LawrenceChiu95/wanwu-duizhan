import {readFile,writeFile} from 'node:fs/promises';
import {rateItem} from '../sim/item-rating.js';
const file=new URL('../data/catalog.json',import.meta.url),catalog=JSON.parse(await readFile(file,'utf8'));
const designs=JSON.parse(await readFile(new URL('../data/default-item-designs.json',import.meta.url),'utf8'));
for(const design of designs.items){
 const item=catalog.items.find(i=>i.id===design.id);if(!item)throw Error(`Default design item missing: ${design.id}`);
 const length=Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i]));
 if(Math.abs(length-design.lengthMeters)>1e-6)throw Error(`Default geometry differs from designed length: ${item.id}`);
 Object.assign(item,{mass:design.massKg,massBasis:'designed-default',material:design.material,condition:design.condition});
}
for(const item of catalog.items)item.rating=rateItem(item,catalog.materials);
await writeFile(file,JSON.stringify(catalog,null,2)+'\n');
const replaced=new Set(catalog.items.filter(i=>i.comparisonBase).map(i=>i.comparisonBase));
const rows=catalog.items.filter(i=>!replaced.has(i.id)).map(i=>({id:i.id,name:i.name,...i.rating.scores,average:(Object.values(i.rating.scores).reduce((a,b)=>a+b,0)/3).toFixed(2),grade:i.rating.grade}));
console.table(rows);
