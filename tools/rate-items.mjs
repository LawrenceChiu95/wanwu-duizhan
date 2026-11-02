import {readFile,writeFile} from 'node:fs/promises';
import {rateItem} from '../sim/item-rating.js';
const file=new URL('../data/catalog.json',import.meta.url),catalog=JSON.parse(await readFile(file,'utf8'));
for(const item of catalog.items)item.rating=rateItem(item,catalog.materials);
await writeFile(file,JSON.stringify(catalog,null,2)+'\n');
const replaced=new Set(catalog.items.filter(i=>i.comparisonBase).map(i=>i.comparisonBase));
const rows=catalog.items.filter(i=>!replaced.has(i.id)).map(i=>({id:i.id,name:i.name,...i.rating.scores,average:(Object.values(i.rating.scores).reduce((a,b)=>a+b,0)/3).toFixed(2),grade:i.rating.grade}));
console.table(rows);
