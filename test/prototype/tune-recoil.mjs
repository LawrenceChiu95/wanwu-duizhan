// Follow-up to the recorded simultaneous-KO failure; all candidates use global rules.
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),dir=await fs.mkdtemp('/Users/lawrence/Projects/agent-copies.noindex/wanwu-calibration-');
await fs.mkdir(dir+'/sim');await fs.mkdir(dir+'/data');
for(const file of ['index.js','math.js','batch.js','layouts.js','package.json'])await fs.copyFile(new URL('sim/'+file,root),dir+'/sim/'+file);
await fs.symlink(new URL('sim/node_modules',root).pathname,dir+'/sim/node_modules');
const catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root),'utf8')),out=new URL('./calibration/',import.meta.url);await fs.mkdir(out,{recursive:true});
for(const fraction of [.03,.01,.05]){
 const arena={...catalog.arena,recoilDamageFraction:fraction};await fs.writeFile(dir+'/data/catalog.json',JSON.stringify({...catalog,arena}));
 const code=`import {runBatch,singleGoals,outcomeStats} from './sim/batch.js';import {runLayouts} from './sim/layouts.js';const rows=await runBatch();const layout=await runLayouts({items:['broom','pot','pillow']});console.log(JSON.stringify({rows,assemblyRows:layout.rows,goals:Object.fromEntries(['A','B'].map(mode=>[mode,singleGoals(rows.filter(r=>r.mode===mode))])),assembly:Object.fromEntries(['A','B'].map(mode=>[mode,outcomeStats(layout.rows.filter(r=>r.mode===mode))]))}));`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',maxBuffer:12e6});if(r.status!==0)throw Error(r.stderr||r.error);
 const result=JSON.parse(r.stdout);await fs.writeFile(new URL(`recoil-${fraction}.json`,out),JSON.stringify({isolatedDirectory:dir,arena,...result},null,2)+'\n');console.log(JSON.stringify({fraction,goals:result.goals,assembly:result.assembly}));
}
console.log('Isolated copy retained until evidence is archived: '+dir);
