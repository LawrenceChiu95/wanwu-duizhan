// One joint control after the approved single-factor runs: restore both opening changes only.
import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {root,fixtures,options,sha,median} from './experiment.mjs';
import {measure} from './measure.mjs';
const out=new URL('./attribution-r3/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',out)));
async function check(){for(const [file,hash] of Object.entries(manifest.frozen))assert.equal(sha(await readFile(new URL(file,root))),hash,file);}
await check();const start=Date.now(),once=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
let s=await readFile(new URL('sim/v3.js',root),'utf8');
const legacy=execFileSync('git',['show','bbaaeb7:sim/v3.js'],{cwd:root,encoding:'utf8',maxBuffer:1000000});
const helper=legacy.match(/function quatFromRotationVector\(v\)\{[^\n]+\}/)?.[0];assert(helper);
s=once(s,'const openingHalfTurn=random(seed^0xd1b54a35)()>=.5;','const openingHalfTurn=false;');
s=once(s,'function buildFighter(world,def,index,c,r,openingHalfTurn){','function buildFighter(world,def,index,c,r,openingHalfTurn,rng){');
s=once(s,'const spin=r.top.spinRate*r.top.spinDirections[index];','const tilt=[(rng()-.5)*.2,0,(rng()-.5)*.2],spin=r.top.spinRate*r.top.spinDirections[index];');
s=once(s,'const q=index===(openingHalfTurn?1:0)?[0,0,0,1]:[0,1,0,0];','const q=quatFromRotationVector(tilt);');
s=once(s,'const active=f=>',helper+'\nconst active=f=>');
s=once(s,'critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn));','const rng=random(seed);critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn,rng));');
s=once(s,'fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*(openingHalfTurn?-1:1)*distance/2,y:0,z:0},true));','fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*distance/2,y:(rng()-.5)*.08,z:(rng()-.5)*.08},true));');
const sourceSha=sha(s),rules=await readFile(new URL('sim/v3-rules.json',root),'utf8');
s=once(s,"new URL('./v3-rules.json',import.meta.url)",`new URL('data:application/json;base64,${Buffer.from(rules).toString('base64')}')`);
s=s.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
for(const file of ['index.js','math.js'])s=s.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
const {simulateV3}=await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
const prior=(await readFile(new URL('./results-r3/rounds.ndjson',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse).filter(r=>r.stage==='feel'&&r.mode==='B'&&r.version==='v12');
await writeFile(new URL('joint-rounds.ndjson',out),'');const rows=[];
for(const f of fixtures)for(let seed=0;seed<50;seed++){
 const {row,replay}=await measure(()=>simulateV3(options(f,seed,'auto',.25,'B'))),old=prior.find(r=>r.fixture===f.id&&r.seed===seed);
 // Only new observational fields are removed; poses, events, damage and outcomes remain byte-for-byte comparable.
 delete replay.meta.openingHalfTurn;delete replay.meta.rules.clashRelativeTolerance;
 for(const e of replay.events)if(e.clash===false)delete e.clash;
 const normalizedFullSha=sha(replay),normalizedFullShaSameAsLegacy=normalizedFullSha===old.replaySha256;
 const r={fixture:f.id,seed,...row,normalizedFullSha,normalizedFullShaSameAsLegacy};rows.push(r);await appendFile(new URL('joint-rounds.ndjson',out),JSON.stringify(r)+'\n');
}
await check();assert.equal(rows.length,300);assert.equal(new Set(rows.map(r=>`${r.fixture}|${r.seed}`)).size,300);
const summary={node:process.version,toolSha:sha(await readFile(new URL(import.meta.url))),sourceSha,scope:'Restore seeded tilt, same-facing pose, jitter and no global half turn together; retain current clash rule and all default parameters. No shipping file modified.',rows:rows.length,over40:rows.filter(r=>r.duration>40).length,pacePass:rows.filter(r=>r.pacePass).length,durationMedian:median(rows.map(r=>r.duration)),separationMedian:median(rows.map(r=>r.separationMedian)),approachMedian:median(rows.map(r=>r.approachMedian)),normalizedFullShaSameAsLegacy:rows.filter(r=>r.normalizedFullShaSameAsLegacy).length,normalization:['meta.openingHalfTurn','meta.rules.clashRelativeTolerance','events[].clash only when false'],wallSeconds:(Date.now()-start)/1000,frozen:manifest.frozen};
await writeFile(new URL('joint-summary.json',out),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
