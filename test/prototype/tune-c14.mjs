// Sequential nice-20 calibration in a private copy; never mutate live UI rules.
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),out=new URL('./c14-calibration/',import.meta.url);
const dir=await fs.mkdtemp('/Users/lawrence/Projects/agent-copies.noindex/wanwu-c14-');
await fs.mkdir(dir+'/sim');await fs.mkdir(dir+'/data');await fs.mkdir(out,{recursive:true});
for(const file of ['index.js','math.js','batch.js','layouts.js','package.json'])await fs.copyFile(new URL('sim/'+file,root),dir+'/sim/'+file);
await fs.symlink(new URL('sim/node_modules',root).pathname,dir+'/sim/node_modules');
const catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root),'utf8'));
const standards=JSON.parse(await fs.readFile(new URL('data/item-standards.json',root),'utf8'));
const cases=JSON.parse(process.argv[2]??'[{"counterSpeedMultiplier":2},{"counterSpeedMultiplier":3},{"counterSpeedMultiplier":5},{"counterSpeedMultiplier":8}]');
const prefix=process.argv[3]??'counter';
for(let i=0;i<cases.length;i++){
 const {disableMatchups,realMasses,fullBatch,...parameters}=cases[i],arena={...catalog.arena,...parameters};const items=realMasses?catalog.items.map(item=>({...item,mass:standards[item.category].massKg})):catalog.items;await fs.writeFile(dir+'/data/catalog.json',JSON.stringify({...catalog,items,arena,matchups:disableMatchups?{}:catalog.matchups}));
 const code=`import {runLayouts} from './sim/layouts.js';import {runGeneratedComparison,outcomeStats,combatGoals,runBatch,singleGoals,counterOutcomes} from './sim/batch.js';import {loadRules} from './sim/index.js';const rows=await runBatch({includeGenerated:true});const layouts=${fullBatch?'await runLayouts({items:["broom","pot","pillow"]})':'null'},generated=${fullBatch?'await runGeneratedComparison(rows.filter(r=>!r.left.endsWith("lux3d")&&!r.right.endsWith("lux3d")))':'null'};const assembly=layouts?{rows:layouts.rows,goals:Object.fromEntries(['A','B'].map(mode=>{const stats=outcomeStats(layouts.rows.filter(r=>r.mode===mode));return[mode,{stats,checks:combatGoals(stats)}]}))}:null;console.log(JSON.stringify({rows,assembly,generated,counterOutcomes:counterOutcomes(rows,await loadRules()),goals:Object.fromEntries(['A','B'].map(mode=>[mode,singleGoals(rows.filter(r=>r.mode===mode))])),originals:Object.fromEntries(['A','B'].map(mode=>[mode,singleGoals(rows.filter(r=>r.mode===mode&&!r.left.endsWith('lux3d')&&!r.right.endsWith('lux3d')))]))}));`;
 const start=performance.now(),r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr||r.error);
 const result=JSON.parse(r.stdout);await fs.writeFile(new URL(`${prefix}-${i+1}.json`,out),JSON.stringify({isolatedDirectory:dir,parameters:cases[i],wallSeconds:(performance.now()-start)/1000,...result},null,2)+'\n');
 console.log(JSON.stringify({case:i+1,parameters:cases[i],goals:Object.fromEntries(Object.entries(result.goals).map(([m,g])=>[m,{checks:g.checks,stats:g.stats,records:g.records.map(r=>({item:r.item,rate:r.rate,best:Math.max(...r.opponents.map(p=>p.rate))}))}]))}));
}
await fs.mkdir(new URL(`sources/${prefix}/`,out),{recursive:true});for(const name of ['index.js','math.js','batch.js'])await fs.copyFile(dir+'/sim/'+name,new URL(`sources/${prefix}/${name}`,out));
await fs.copyFile(new URL('data/catalog.json',root),new URL(`sources/${prefix}/catalog-base.json`,out));
console.log('Archived source; private copy retained for explicit cleanup: '+dir);
