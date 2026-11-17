import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
// Judge ce64f25; Elara 4199bd40: .25 s applies while waiting to block.
// A player charging/dashing between cue and impact is counted separately.
const baseline={mang:{wins:83,cooling:2,charges:799,cue:.25},wen:{wins:38,cooling:1,charges:688,cue:.25},chang:{wins:3,cooling:15,charges:790,cue:.25}};
const run=id => new Promise((resolve,reject) => {
  const worker=new Worker(new URL('./first-dash.mjs',import.meta.url),{workerData:id});
  let result;
  worker.on('message',r => {result=r;});worker.on('error',reject);
  worker.on('exit',code => code===0 && result ? resolve(result) : reject(Error(`${id} worker exited ${code}`)));
});
test('first-dash-missed-cues: all three opponents retain the current judge baseline', {timeout:180000},async t => {
  const ids=Object.keys(baseline),results=await Promise.all(ids.map(run));
  for (const [i,id] of ids.entries()) await t.test(id,() => {
    const r=results[i],b=baseline[id];
    console.log(JSON.stringify({proxy:'first-dash-missed-cues',foe:id,games:r.games,wins:r.wins,
      cueMin:r.minCue,mutual:r.mutual,belowQuarter:r.belowQuarter,landings:r.landings,
      blockCooling:r.cooling,charges:r.charges,intervals:r.intervals,
      scheduledCooldownTicks:[r.cooldowns[0],r.cooldowns.at(-1)],jitterValues:r.cooldowns.length}));
    assert.equal(r.games,96,'Both original seed ranges must run');
    assert(r.cooldowns.length>1,`${id} accepted dash cooldown needs seeded jitter, not a fixed beat`);
    assert(r.wins>=b.wins,`${id} win baseline ${b.wins}/96, got ${r.wins}/96`);
    assert(Number.isFinite(r.minCue) && r.minCue>=b.cue-1e-9,`${id} cue floor ${b.cue}, got ${r.minCue}`);
    assert(r.charges>0 && r.cooling*b.charges<=b.cooling*r.charges,`${id} starts during block cooldown: ${r.cooling}/${r.charges} exceeds ${b.cooling}/${b.charges}`);
    assert(r.intervals[1]>r.intervals[0],`${id} attacks need varying intervals`);
  });
});
