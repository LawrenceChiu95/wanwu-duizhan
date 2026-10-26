// Calibrate only a private copy; do not expose intermediate parameters to the UI.
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),dir=await fs.mkdtemp('/Users/lawrence/Projects/agent-copies.noindex/wanwu-calibration-');
await fs.mkdir(dir+'/sim');await fs.mkdir(dir+'/data');
for(const file of ['index.js','math.js','batch.js','package.json'])await fs.copyFile(new URL('sim/'+file,root),dir+'/sim/'+file);
await fs.symlink(new URL('sim/node_modules',root).pathname,dir+'/sim/node_modules');
const catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root),'utf8')),out=new URL('./calibration/',import.meta.url);await fs.mkdir(out,{recursive:true});
const cases=[{maxHitFraction:.3,damageCooldown:2.5,impulseToDamage:100,statDamageScale:3.5},{maxHitFraction:.35,damageCooldown:2.5,impulseToDamage:100,statDamageScale:3.5},{maxHitFraction:.3,damageCooldown:2.5,impulseToDamage:150,statDamageScale:5},{maxHitFraction:.3,damageCooldown:1.5,impulseToDamage:100,statDamageScale:3.5},{maxHitFraction:.3,damageCooldown:2.5,impulseToDamage:60,statDamageScale:4}];
for(let i=0;i<cases.length;i++){
 const arena={...catalog.arena,...cases[i]};await fs.writeFile(dir+'/data/catalog.json',JSON.stringify({...catalog,arena}));
 const code=`import {runBatch,singleGoals} from './sim/batch.js';const rows=await runBatch();console.log(JSON.stringify({rows,goals:Object.fromEntries(['A','B'].map(mode=>[mode,singleGoals(rows.filter(r=>r.mode===mode))]))}));`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr||r.error);
 const result=JSON.parse(r.stdout);await fs.writeFile(new URL(`case-${i+1}.json`,out),JSON.stringify({isolatedDirectory:dir,arena,...result},null,2)+'\n');console.log(JSON.stringify({case:i+1,parameters:cases[i],goals:result.goals}));
}
console.log('Isolated copy retained until evidence is archived: '+dir);
