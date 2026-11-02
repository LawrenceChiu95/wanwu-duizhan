import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rateItem} from '../sim/item-rating.js';
import {readJson,saveJson,withLock} from './import-item/state.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export async function rateItems({repoRoot=ROOT,log=console.table}={}){
 const root=path.resolve(repoRoot),folder=path.join(root,'.aholo');
 await mkdir(folder,{recursive:true});
 return withLock(path.join(folder,'catalog-lock'),async()=>{
  const file=path.join(root,'data','catalog.json'),catalog=await readJson(file);
  const designs=await readJson(path.join(root,'data','default-item-designs.json'));
  for(const design of designs.items){
   const item=catalog.items.find(i=>i.id===design.id);if(!item)throw Error(`Default design item missing: ${design.id}`);
   const length=Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i]));
   if(Math.abs(length-design.lengthMeters)>1e-6)throw Error(`Default geometry differs from designed length: ${item.id}`);
   Object.assign(item,{mass:design.massKg,massBasis:'designed-default',material:design.material,condition:design.condition});
  }
  for(const item of catalog.items)item.rating=rateItem(item,catalog.materials);
  await saveJson(file,catalog);
  const rows=designs.items.map(d=>catalog.items.find(i=>i.id===d.id)).map(i=>({id:i.id,name:i.name,...i.rating.scores,average:(Object.values(i.rating.scores).reduce((a,b)=>a+b,0)/3).toFixed(2),grade:i.rating.grade}));
  log(rows);return catalog;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))rateItems().catch(error=>{console.error(error.message);process.exitCode=1;});
