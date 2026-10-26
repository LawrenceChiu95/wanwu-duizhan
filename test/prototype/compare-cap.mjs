// A/B controlled cap comparison in an isolated copy; never edits shared catalog.
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),dir=await fs.mkdtemp('/Users/lawrence/Projects/agent-copies.noindex/wanwu-calibration-');
await fs.mkdir(dir+'/sim');await fs.mkdir(dir+'/data');
for(const file of ['index.js','math.js','batch.js','package.json'])await fs.copyFile(new URL('sim/'+file,root),dir+'/sim/'+file);
await fs.symlink(new URL('sim/node_modules',root).pathname,dir+'/sim/node_modules');
const catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root),'utf8'));catalog.arena.maxHitFraction=.35;await fs.writeFile(dir+'/data/catalog.json',JSON.stringify(catalog));
const r=spawnSync(process.execPath,['--input-type=module','-e',`import {runBatch} from './sim/batch.js';console.log(JSON.stringify(await runBatch()));`],{cwd:dir,encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr);const rows=JSON.parse(r.stdout);const summary=Object.fromEntries(['A','B'].map(mode=>{const rs=rows.filter(x=>x.mode===mode),ds=rs.map(x=>x.duration).sort((a,b)=>a-b);return [mode,{under20:rs.filter(x=>x.duration<20).length,shortest:ds[0],median:ds[37],finishes:rs.reduce((s,x)=>(s[x.finishType]=(s[x.finishType]??0)+1,s),{})}];}));const receipt={isolatedDirectory:dir,changedOnly:'arena.maxHitFraction = .35',summary,rows};await fs.writeFile(new URL('./cap35-comparison.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({isolatedDirectory:dir,summary}));
