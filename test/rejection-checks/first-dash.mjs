// The first-dash-missed-cues proxy used for the 11-17 paired judge regression.
// Source/contract: #万物对战:8962d218; default pot + cushion, no chair.
import {readFileSync} from 'node:fs';
import {createV3Match, MATERIAL_JUDGE_COMBAT_OPTIONS as preset} from '../../sim/v3.js';
import {random} from '../../sim/math.js';
const {foes, judgeBuilds} = JSON.parse(readFileSync(new URL('../../data/foes.json', import.meta.url)));
export const seeds = [111300, 222100].flatMap(start => Array.from({length: 48}, (_, n) => start + n));
const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
export async function firstDash(id, seed) {
  const foe = foes.find(f => f.id === id), tuned = judgeBuilds.position[id];
  const rng = random(seed ^ 0xe8b76166);
  const match = await createV3Match({...preset, seed,
    fighters: [build([{item:'fanshuo-pot', orient:'out'}, {item:'fanshuo-cushion', orient:'hug'}]), build(tuned.parts, tuned.spread)],
    combatRules: {...preset.combatRules, ceramicShards:true},
    manual: {sides:['input','ai'], aiProfiles:[null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}]}});
  let cursor = 0, plan;
  const scheduledCooldowns=[], cueDistances=new Map(), activeAtCue=new Map();
  try {
    while (true) {
      for (; cursor < match.events.length; cursor++) {
        const e = match.events[cursor];
        if (e.type==='dash' && e.side===1 && e.phase==='charge') scheduledCooldowns.push(Math.round(match.control(1).dashIn/match.rules.dt));
        if (e.type==='dashCue' && e.side===1) {
          const [a,b]=match.frames.at(-1).fighters;
          activeAtCue.set(e.pressStep,match.control(0).charging || match.control(0).dashing);
          cueDistances.set(e.pressStep,Math.hypot(a.pos[0]-b.pos[0],a.pos[2]-b.pos[2]));
        }
        if (e.type === 'dash' && e.side === 1 && e.phase === 'end' && plan?.step === e.pressStep) plan = undefined;
        if (e.type === 'dashCue' && e.side === 1 && rng() >= 1/3) plan = {at:e.t + .25 + rng()*.30, step:e.pressStep};
      }
      if (match.done) break;
      const c = match.control(0);
      if (plan && match.t >= plan.at - 1e-9) { match.press(0, 'block'); plan = undefined; }
      else if (!c.dashIn && !c.stunIn && !c.charging && !c.dashing && !c.shield) match.press(0, 'dash');
      match.advance();
    }
    const {events, meta} = match.result();
    const charges = events.filter(e => e.type === 'dash' && e.side === 1 && e.phase === 'charge');
    const cues = events.filter(e => e.type === 'dashCue' && e.side === 1);
    const landed = events.filter(e => e.type === 'dash' && e.side === 1 && e.phase === 'end' && ['hit','blocked'].includes(e.outcome));
    const leads = landed.map(e => {
      const cue = cues.find(c => c.pressStep === e.pressStep);
      const mutual=Boolean(activeAtCue.get(e.pressStep) || events.some(p => p.type==='dash' && p.side===0 && p.phase==='charge' && p.t>=(cue?.t??0) && p.t<=e.t));
      return {seed, step:e.pressStep, mutual, seconds:cue ? e.t-cue.t : 0, distanceAtCue:cueDistances.get(e.pressStep),
        contact:events.filter(x => x.t===e.t && (x.type==='contact' || x.role==='attack')).map(x => ({type:x.type,attacker:x.attacker,dash:x.dash,parry:x.parry,damage:x.damage})),
        end:{t:e.t,outcome:e.outcome,quality:e.quality,point:e.point}};
    });
    return {win:meta.winner === 0, charges:charges.length, cooling:charges.filter(e => e.blockReadyIn > 0).length,
      leads, cooldowns:scheduledCooldowns, intervals:charges.slice(1).map((c,i) => +(c.t-charges[i].t).toFixed(6))};
  } finally { match.free(); }
}
export async function measure(id, sample = seeds) {
  const rows = [];
  for (const seed of sample) rows.push(await firstDash(id, seed));
  return {games:rows.length, wins:rows.filter(r => r.win).length,
    charges:rows.reduce((n,r) => n+r.charges,0), cooling:rows.reduce((n,r) => n+r.cooling,0),
    minCue:Math.min(...rows.flatMap(r => r.leads.filter(l => !l.mutual).map(l => l.seconds))),
    mutual:rows.flatMap(r => r.leads).filter(l => l.mutual).length,
    landings:rows.reduce((n,r) => n+r.leads.length,0),
    belowQuarter:rows.flatMap(r => r.leads).filter(l => !l.mutual && l.seconds < .25-1e-9).length,
    shortest:rows.flatMap(r => r.leads).filter(l => !l.mutual).sort((a,b) => a.seconds-b.seconds).slice(0,3),
    cooldowns:[...new Set(rows.flatMap(r => r.cooldowns))].sort((a,b) => a-b),
    intervals:[Math.min(...rows.flatMap(r => r.intervals)), Math.max(...rows.flatMap(r => r.intervals))]};
}

// One physics worker per opponent keeps this 288-game CI batch bounded.
import {isMainThread, parentPort, workerData} from 'node:worker_threads';
if (!isMainThread) parentPort.postMessage(await measure(workerData));
