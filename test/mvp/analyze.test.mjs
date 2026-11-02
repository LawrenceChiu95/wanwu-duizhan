import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const fixtures=Array.from({length:6},(_,i)=>({id:`scene-${i}`}));
function primary(deltas){return fixtures.flatMap((f,i)=>Array.from({length:100},(_,seed)=>['manual','timing'].map(condition=>({plan:{radius:2.2,scene:f.id,seed,condition},score:condition==='timing'&&seed<deltas[i]?1:0,initialOuter:[2,2],duration:30,firstDamage:.2,maxCoreRadius:2.2}))).flat());}
async function analyze(stage,rows,compressed=false,manifest={}){
 const dir=await mkdtemp(join(tmpdir(),'wanwu-analyze-'));
 await writeFile(join(dir,'manifest.json'),JSON.stringify({stage,n:100,planned:1200,fixtures,defaultItems:[],...manifest}));
 const raw=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
 await writeFile(join(dir,compressed?'rounds.ndjson.gz':'rounds.ndjson'),compressed?gzipSync(raw):raw);
 execFileSync(process.execPath,[fileURLToPath(new URL('./analyze.mjs',import.meta.url))],{env:{...process.env,MVP_OUT:pathToFileURL(dir+'/').href},stdio:'pipe'});
 return JSON.parse(await readFile(join(dir,'summary.json'),'utf8'));
}
test('timing acceptance uses the median of six paired-seed scene differences, including the 15-point boundary',async()=>{
 for(const [deltas,expected,pass] of [[[0,0,15,15,100,100],15,true],[[0,0,14,15,100,100],14.5,false]]){
  const s=await analyze('primary',primary(deltas),true);assert.equal(s.timingSummary[0].medianDeltaPoints,expected);assert.equal(s.timingSummary[0].pass,pass);assert.equal(s.timingSummary[0].complete,true);
 }
 const rows=primary([20,20,20,20,20,20]);rows[0].plan.seed=1;
 let s=await analyze('primary',rows);assert.equal(s.timingSummary[0].complete,false);assert.equal(s.timingSummary[0].pass,false);
 rows.pop();s=await analyze('primary',rows);assert.equal(s.timingSummary[0].pass,false);
});
test('mirror acceptance needs a complete fixed 1000-seed panel with both AI stream orders',async()=>{
 const rows=fixtures.flatMap(f=>Array.from({length:1000},(_,i)=>[false,true].map(swap=>({plan:{radius:2.2,scene:f.id,seed:30000+i,swap},score:swap?0:1,initialOuter:[2,2]}))).flat());
 const manifest={n:1000,seedStart:30000,planned:12000};
 let s=await analyze('fair',rows,false,manifest);assert.ok(s.scenes.every(x=>x.complete&&x.pass&&x.scorePct===50));
 const old=rows.filter(r=>r.plan.seed<30200);s=await analyze('fair',old,false,{n:200,seedStart:30000,planned:2400});assert.ok(s.scenes.every(x=>!x.pass));
 rows[1].plan.swap=false;s=await analyze('fair',rows,false,manifest);assert.equal(s.scenes[0].complete,false);assert.equal(s.scenes[0].pass,false);
 rows[1].plan.swap=true;rows[1].plan.seed=31000;s=await analyze('fair',rows,false,manifest);assert.equal(s.scenes[0].pass,false);
 rows.pop();s=await analyze('fair',rows,false,manifest);assert.ok(s.scenes.every(x=>!x.pass));
});
test('every analysis stage reports opening envelope violations and explicitly missing wall samples',async()=>{
 for(const stage of ['primary','fair','layout','strength','combos','combo-check']){
  const rows=primary([20,20,20,20,20,20]);rows[0].initialOuter=[2.3,2];delete rows[1].initialOuter;
  // The unrelated stage-specific tables may be empty; the common opening audit must still work.
  if(['combos','combo-check'].includes(stage))for(const r of rows){r.plan.combo=['a','b'];r.plan.leftOrient='out';r.plan.rightOrient='out';r.plan.spread='e180';}
  const s=await analyze(stage,rows);assert.equal(s.opening[0].initialOutside,1);assert.equal(s.opening[0].missing,1);assert.equal(s.opening[0].maxInitialOuter,2.3);assert.equal(s.walls.checked,0);assert.equal(s.walls.missing,rows.length);assert.equal(s.walls.maxSampledPartExcess,null);
 }
});
