import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root='/Users/lawrence/Projects/wanwu-duizhan',source=await fs.readFile(root+'/sim/index.js','utf8'),catalog=JSON.parse(await fs.readFile(root+'/data/catalog.json'));
for(const [name,settings,body] of [
 ['stiff120','world.integrationParameters.numSolverIterations=8;world.integrationParameters.contact_natural_frequency=120;',''],
 ['stiff240','world.integrationParameters.numSolverIterations=8;world.integrationParameters.contact_natural_frequency=240;',''],
 ['pgs2','world.integrationParameters.numSolverIterations=8;world.integrationParameters.numInternalPgsIterations=2;world.integrationParameters.contact_natural_frequency=120;','']
]){
 let code=source.replace('world.timestep=a.dt;','world.timestep=a.dt;'+settings);if(body)code=code.replace('.setCcdEnabled(true)',body+'.setCcdEnabled(true)');
 await fs.writeFile('sim/index.js',code);await fs.writeFile('data/catalog.json',JSON.stringify(catalog));
 const r=spawnSync(process.execPath,['--input-type=module','-e',"import {runBatch,singleGoals} from './sim/batch.js';const rows=await runBatch();console.log(JSON.stringify({rows,goals:Object.fromEntries(['A','B'].map(mode=>[mode,singleGoals(rows.filter(r=>r.mode===mode))]))}));"],{encoding:'utf8',maxBuffer:1e7});if(r.status)throw Error(r.stderr);
 const p=spawnSync(process.execPath,['test/prototype/penetration-check.mjs'],{encoding:'utf8'});if(p.status)throw Error(p.stderr);
 const result={name,settings,body,...JSON.parse(r.stdout),probe:JSON.parse(p.stdout)};
 await fs.writeFile(root+'/test/prototype/precision-'+name+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({name,goals:result.goals,probe:result.probe}));
}
