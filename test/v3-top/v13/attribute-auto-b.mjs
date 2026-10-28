// Approved single-factor evidence only. No shipping file or default parameter is modified.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {root,fixtures,options,sha,median,baseline} from './experiment.mjs';
import {measure} from './measure.mjs';
const out=new URL('./attribution-r3/',import.meta.url);await mkdir(out,{recursive:true});
const source=await readFile(new URL('sim/v3.js',root),'utf8'),rules=await readFile(new URL('sim/v3-rules.json',root),'utf8');
const sourceSha=sha(source),ruleSha=sha(rules),catalogSha=sha(await readFile(new URL('data/catalog.json',root)));
const frozen=(JSON.parse(await readFile(new URL('./results-r3/manifest.json',import.meta.url)))).sources;
async function checkFrozen(){for(const [file,hash] of Object.entries(frozen))assert.equal(sha(await readFile(new URL(file,root))),hash,file);}
await checkFrozen();
const batch=(await readFile(new URL('./results-r3/rounds.ndjson',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const current=batch.filter(r=>r.stage==='feel'&&r.mode==='B'&&r.version==='v13'),old=batch.filter(r=>r.stage==='feel'&&r.mode==='B'&&r.version==='v12');assert.equal(current.length,300);assert.equal(old.length,300);
const {simulateV3:oldRun}=await baseline();
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
async function load(s){
 const variantSha=sha(s);
 s=once(s,"new URL('./v3-rules.json',import.meta.url)",`new URL('data:application/json;base64,${Buffer.from(rules).toString('base64')}')`);
 s=s.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const file of ['index.js','math.js'])s=s.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
 return {variantSha,simulate:(await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'))).simulateV3};
}
const definitions=[];
let s=once(source,'const dir=f.ctl.lockedDir,v=arr(f.body.linvel());','const dir=flat(arr(f.body.worldCom()),arr(fs[1-i].body.worldCom())),v=arr(f.body.linvel());');
s=once(s,'const dir=f.ctl.lockedDir,sideways=','const dir=flat(p,arr(fs[1-i].body.worldCom())),sideways=');
definitions.push({id:'dash-follow',purpose:'Disable motion direction lock only; automatic mode executes neither branch.',source:s,expectSame:true});
s=once(source,'k.shieldUntil=step+steps(M.blockTime)-1;','k.shieldUntil=step+steps(1)-1;');
s=once(s,'if(k.blockResolved)return;k.blockResolved=true;','if(k.blockResolved)return;if(outcome===\'empty\')k.blockReady=0;k.blockResolved=true;');
definitions.push({id:'long-block-refund-empty',purpose:'Use a 1s shield and refund empty cooldown; automatic mode has no manual state.',source:s,expectSame:true});
s=once(source,'let roles=topStrikeRoles(','let roles=strikeRoles(');
definitions.push({id:'no-double-clash',purpose:'Restore pre-v13 strikeRoles attacker selection, including its known numeric seat bias; no tuning.',source:s});
s=once(source,'const openingHalfTurn=random(seed^0xd1b54a35)()>=.5;','const openingHalfTurn=false;');
definitions.push({id:'no-global-half-turn',purpose:'Fixed global orientation while retaining symmetric opening.',source:s});
// Reintroduce exactly the old seeded starting pose and position, then apply the existing global half turn.
const legacy=execFileSync('git',['show','bbaaeb7:sim/v3.js'],{cwd:root,encoding:'utf8',maxBuffer:1000000});
const tiltHelper=legacy.match(/function quatFromRotationVector\(v\)\{[^\n]+\}/)?.[0];assert(tiltHelper);
s=once(source,'function buildFighter(world,def,index,c,r,openingHalfTurn){','function buildFighter(world,def,index,c,r,openingHalfTurn,openingRng){');
s=once(s,'const spin=r.top.spinRate*r.top.spinDirections[index];','const tilt=[(openingRng()-.5)*.2,0,(openingRng()-.5)*.2],spin=r.top.spinRate*r.top.spinDirections[index];');
s=once(s,'const q=index===(openingHalfTurn?1:0)?[0,0,0,1]:[0,1,0,0];','const baseQ=quatFromRotationVector(tilt),q=openingHalfTurn?[baseQ[2],baseQ[3],-baseQ[0],-baseQ[1]]:baseQ;');
s=once(s,'const active=f=>',tiltHelper+'\nconst active=f=>');
s=once(s,'critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn));','const openingRng=random(seed);critRoll=random(seed^0x9e3779b9);fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r,openingHalfTurn,openingRng));');
s=once(s,'fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*(openingHalfTurn?-1:1)*distance/2,y:0,z:0},true));','fs.forEach((f,i)=>f.body.setTranslation({x:(i===0?-1:1)*(openingHalfTurn?-1:1)*distance/2,y:(openingRng()-.5)*.08,z:(openingRng()-.5)*.08*(openingHalfTurn?-1:1)},true));');
definitions.push({id:'old-asymmetric-opening',purpose:'Old same-facing seeded tilts and position jitter, preserving current half-turn bit and every other v13 rule.',source:s});
await writeFile(new URL('manifest.json',out),JSON.stringify({sourceSha,ruleSha,catalogSha,frozen,toolSha:sha(await readFile(new URL(import.meta.url))),node:process.version,fixtures,seeds:50,reference:'../results-r3/rounds.ndjson',planned:1500,additionalChecks:4,variants:definitions.map(({source,...v})=>({...v,sourceSha:sha(source)})),scope:'Each intervention is isolated in memory; no shipping default changed.'},null,2)+'\n');
await writeFile(new URL('rounds.ndjson',out),'');const rows=[],openingProof=[],start=Date.now();
for(const d of definitions){
 const {simulate,variantSha}=await load(d.source);
 for(const f of fixtures)for(let seed=0;seed<50;seed++){
  const {row,replay}=await measure(()=>simulate(options(f,seed,'auto',.25,'B'))),reference=current.find(r=>r.fixture===f.id&&r.seed===seed);
  if(d.expectSame)assert.equal(row.replaySha256,reference.replaySha256,`${d.id} ${f.id} ${seed}`);
  if(d.id==='old-asymmetric-opening'&&f===fixtures[0]&&[1,7].includes(seed)){
   const prior=await oldRun(options(f,seed,'auto',.25,'B')),turn=replay.meta.openingHalfTurn;
   const rotateHalf=a=>turn?[-a[0],a[1],-a[2]]:a,err=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i]))),errors=[];
   for(let i=0;i<2;i++){
    const a=replay.frames[0].fighters[i],b=prior.frames[0].fighters[i];
    for(const key of ['pos','centerOfMass','angularVelocity'])errors.push(err(a[key],rotateHalf(b[key])));
    const q=b.quat,expected=turn?[q[2],q[3],-q[0],-q[1]]:q;
    errors.push(Math.min(err(a.quat,expected),err(a.quat,expected.map(x=>-x))));
   }
   const maxError=Math.max(...errors);assert(maxError<1e-6,`legacy pose ${seed}: ${maxError}`);openingProof.push({seed,openingHalfTurn:turn,maxError});
  }
  const r={variant:d.id,fixture:f.id,seed,...row,variantSha,referenceFullShaEqual:row.replaySha256===reference.replaySha256};rows.push(r);await appendFile(new URL('rounds.ndjson',out),JSON.stringify(r)+'\n');
 }
 console.log(`${d.id}: ${rows.length}/1500, ${((Date.now()-start)/1000).toFixed(1)}s`);
}
// Same-input legacy geometry comparison for the one worst v13 residual. This is one case, not an old batch maximum.
const f=fixtures.find(f=>f.id==='scissors-pillow/out-out-e180'),seed=130;
const record=batch.find(r=>r.stage==='fair'&&r.fixture===f.id&&r.seed===seed&&r.condition==='ai-left');assert(record);
const base={fighters:[f.definition,f.definition],mode:'A',seed,manual:{sides:['ai','ai'],aiSeeds:record.aiSeeds,blockTime:.25}};
const native=(await measure(()=>oldRun({...base,manual:{sides:['ai','ai']}}))).row;
const currentReplay=JSON.parse(gunzipSync(await readFile(new URL('./results-r3/failures/residual-maximum.json.gz',import.meta.url))));assert.equal(sha(currentReplay),record.replaySha256);
const inputs=currentReplay.events.filter(e=>e.type==='press').map(e=>({step:Math.round(e.t/currentReplay.meta.rules.dt),side:e.side,action:e.action}));
const transcript=(await measure(()=>oldRun({...base,manual:{sides:['input','input'],inputs}}))).row;
await writeFile(new URL('old-residual-case.json',out),JSON.stringify({fixture:f.id,seed,current:record,legacyNativeAi:native,legacyCurrentPressTranscript:transcript,requestedInputs:inputs,requestedCounts:[0,1].map(i=>inputs.filter(x=>x.side===i).length),legacy:'bbaaeb7',scope:'Legacy lacks v13 reaction jitter and has a different shield window. Native AI is the actual old same-seed result; the current press transcript is an additional control, not a claim of identical physics or accepted input.'},null,2)+'\n');
const stats=rs=>({n:rs.length,over40:rs.filter(r=>r.duration>40).length,under20:rs.filter(r=>r.duration<20).length,pacePass:rs.filter(r=>r.pacePass).length,durationMedian:median(rs.map(r=>r.duration)),separationMedian:median(rs.map(r=>r.separationMedian)),approachMedian:median(rs.map(r=>r.approachMedian))});
const groups=[{id:'v12',rows:old},{id:'v13',rows:current},...definitions.map(d=>({id:d.id,rows:rows.filter(r=>r.variant===d.id)}))];
const summary=groups.map(({id,rows:rs})=>({id,...stats(rs),fullShaSameAsCurrent:rs.filter(r=>r.replaySha256===current.find(c=>c.fixture===r.fixture&&c.seed===r.seed).replaySha256).length,byFixture:fixtures.map(f=>({fixture:f.id,...stats(rs.filter(r=>r.fixture===f.id))}))}));
const transitions=definitions.filter(d=>!d.expectSame).map(d=>({variant:d.id,recoveredCurrentOver40:rows.filter(r=>r.variant===d.id&&r.duration<=40&&current.find(c=>c.fixture===r.fixture&&c.seed===r.seed).duration>40).map(r=>({fixture:r.fixture,seed:r.seed})),newOver40:rows.filter(r=>r.variant===d.id&&r.duration>40&&current.find(c=>c.fixture===r.fixture&&c.seed===r.seed).duration<=40).map(r=>({fixture:r.fixture,seed:r.seed}))}));
const added=current.filter(r=>r.duration>40&&old.find(x=>x.fixture===r.fixture&&x.seed===r.seed).duration<=40).map(r=>({fixture:r.fixture,seed:r.seed,duration:r.duration,legacyDuration:old.find(x=>x.fixture===r.fixture&&x.seed===r.seed).duration,ablations:Object.fromEntries(definitions.filter(d=>!d.expectSame).map(d=>[d.id,rows.find(x=>x.variant===d.id&&x.fixture===r.fixture&&x.seed===r.seed).duration]))}));
await checkFrozen();
assert.equal(rows.length,1500);assert.equal(new Set(rows.map(r=>`${r.variant}|${r.fixture}|${r.seed}`)).size,1500);
assert.equal(openingProof.length,2);assert.deepEqual(new Set(openingProof.map(x=>x.openingHalfTurn)),new Set([false,true]));
const oldToCurrent={newlyOver40:added.length,recovered:old.filter(r=>r.duration>40&&current.find(c=>c.fixture===r.fixture&&c.seed===r.seed).duration<=40).length,net:current.filter(r=>r.duration>40).length-old.filter(r=>r.duration>40).length};
await writeFile(new URL('summary.json',out),JSON.stringify({complete:true,rows:1500,additionalChecks:4,wallSeconds:(Date.now()-start)/1000,sourceSha,ruleSha,catalogSha,frozen,openingProof,oldToCurrent,summary,transitions,added,legacyTranscriptResidual:transcript.residual,legacyNativeResidual:native.residual,currentResidual:record.residual},null,2)+'\n');
console.log(JSON.stringify({complete:true,summary:summary.map(({byFixture,...s})=>s),added:added.length,residual:{current:record.residual,transcript:transcript.residual,native:native.residual}}));
