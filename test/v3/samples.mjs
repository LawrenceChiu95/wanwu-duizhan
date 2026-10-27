// Short frontend contract smoke, independent of the long pairwise matrix.
import {simulateV3}from'../../sim/v3.js';import{definition,metrics}from'./probe.mjs';
import{writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';
const dir=new URL('./samples/',import.meta.url);await mkdir(dir,{recursive:true});
const cases=[{name:'ordinary',left:'broom',right:'pot',mode:'B',seed:1},{name:'breaks',left:'scissors',right:'lamp-lux3d',mode:'A',seed:3},{name:'weak',left:'lamp',right:'scissors',mode:'A',seed:1}],rows=[];
for(const c of cases){const r=await simulateV3({fighters:[definition(c.left),definition(c.right)],mode:c.mode,seed:c.seed}),data=JSON.stringify(r);await writeFile(new URL(c.name+'.json',dir),data);rows.push({...c,file:c.name+'.json',sha256:createHash('sha256').update(data).digest('hex'),...metrics(r)});}
await writeFile(new URL('index.json',dir),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
