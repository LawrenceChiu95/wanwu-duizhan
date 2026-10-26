// Probe the two worst recorded contacts in an isolated solver copy.
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),dir=await fs.mkdtemp('/Users/lawrence/Projects/agent-copies.noindex/wanwu-calibration-');
await fs.mkdir(dir+'/sim');await fs.mkdir(dir+'/data');await fs.mkdir(dir+'/test/prototype',{recursive:true});
for(const file of ['index.js','math.js','batch.js','layouts.js','package.json'])await fs.copyFile(new URL('sim/'+file,root),dir+'/sim/'+file);
await fs.symlink(new URL('sim/node_modules',root).pathname,dir+'/sim/node_modules');
await fs.copyFile(new URL('./penetration-check.mjs',import.meta.url),dir+'/test/prototype/penetration-check.mjs');
for(const kind of ['batch','layouts']){await fs.mkdir(dir+'/test/prototype/'+kind);await fs.copyFile(new URL(`./${kind}/rounds.json`,import.meta.url),dir+'/test/prototype/'+kind+'/rounds.json');}
const source=await fs.readFile(dir+'/sim/index.js','utf8'),catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root),'utf8'));
for(const variant of ['solver8-ccd4','step120']){
 let code=source.replace('world.timestep=a.dt;','world.timestep=a.dt;world.integrationParameters.numSolverIterations=8;world.integrationParameters.maxCcdSubsteps=4;');
 const c=structuredClone(catalog);if(variant==='step120'){c.arena.dt=1/120;code=code.replace('step%2===0','step%Math.round(1/(30*a.dt))===0').replace('step%30===0','step%Math.round(.5/a.dt)===0');}
 await fs.writeFile(dir+'/sim/index.js',code);await fs.writeFile(dir+'/data/catalog.json',JSON.stringify(c));
 const r=spawnSync(process.execPath,['test/prototype/penetration-check.mjs'],{cwd:dir,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.error);
 const results=JSON.parse(r.stdout);await fs.writeFile(new URL(`./contact-${variant}.json`,import.meta.url),JSON.stringify({isolatedDirectory:dir,variant,results},null,2)+'\n');console.log(JSON.stringify({variant,results}));
}
console.log('Isolated copy retained until evidence is archived: '+dir);
