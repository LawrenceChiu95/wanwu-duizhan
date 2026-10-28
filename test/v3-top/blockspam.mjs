// 「只按挡」玩家：挡一好就按、从不冲，对网页的固定对手（电脑会冲会挡）；对照同一批局玩家什么都不按。
// Usage: nice -n 20 node test/v3-top/blockspam.mjs [games=60]
import {simulateV3, loadV3Rules} from '../../sim/v3.js';
import {LOADOUTS, FOE} from './loadouts.mjs';
import {random} from '../../sim/math.js';
const n=Number(process.argv[2]??60),r=await loadV3Rules(),every=Math.round(r.manual.blockCooldown/r.dt),last=Math.round(r.maxDuration/r.dt);
const spam=[];for(let k=1;k<=last;k+=every)spam.push({step:k,side:0,action:'block'});
const pick=random(4242),rows=[];
for(let g=0;g<n;g++){
 const me=LOADOUTS[Math.floor(pick()*LOADOUTS.length)],seed=3000+g;
 const run=async inputs=>{const x=await simulateV3({fighters:[me,FOE],mode:'A',seed,manual:{sides:['input','ai'],inputs}});const hits=x.events.filter(e=>(e.type==='hit'||e.type==='weak')&&e.role==='attack'&&e.damage>0);return {duration:x.meta.duration,winner:x.meta.winner,reason:x.meta.reason,blocks:x.meta.manual.inputs.length,meDealt:hits.filter(e=>e.attacker===0).reduce((s,e)=>s+e.damage,0),meTook:hits.filter(e=>e.attacker===1).reduce((s,e)=>s+e.damage,0)};};
 rows.push({g,seed,me,spam:await run(spam),idle:await run([])});
}
const q=(xs,p)=>{const s=[...xs].sort((a,b)=>a-b);return +s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(1);};
const sum=k=>{const d=rows.map(x=>x[k].duration);return {games:n,win:+(rows.filter(x=>x[k].winner===0).length/n).toFixed(3),draws:rows.filter(x=>x[k].winner===null).length,duration:{p10:q(d,.1),median:q(d,.5),p90:q(d,.9),max:q(d,1)},over40:d.filter(x=>x>40).length,under20:d.filter(x=>x<20).length,timeouts:rows.filter(x=>x[k].reason==='timeout').length,blocksPerGame:+(rows.reduce((s,x)=>s+x[k].blocks,0)/n).toFixed(1),dealtMedian:q(rows.map(x=>x[k].meDealt),.5),tookMedian:q(rows.map(x=>x[k].meTook),.5)};};
const out={maxDuration:r.maxDuration,blockEvery:r.manual.blockCooldown,spam:sum('spam'),idle:sum('idle'),longest:rows.sort((a,b)=>b.spam.duration-a.spam.duration).slice(0,3).map(x=>({seed:x.seed,me:x.me.parts.map(p=>`${p.item}/${p.orient}`).join('+')+'@'+x.me.parts[1].mount,spam:x.spam,idle:x.idle}))};
console.log(JSON.stringify(out,null,1));
