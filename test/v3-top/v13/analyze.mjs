import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fixtures,median} from './experiment.mjs';
const dir=new URL('./results/',import.meta.url),rows=(await readFile(new URL('rounds.ndjson',dir),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
if(!process.argv.includes('--partial'))assert.equal(rows.length,manifest.planned);
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
const percent=xs=>xs.length?100*mean(xs):null;
const rate=xs=>({n:xs.length,wins:xs.filter(x=>x.winner===0).length,draws:xs.filter(x=>x.winner===null).length,timeouts:xs.filter(x=>x.reason==='timeout').length,score:percent(xs.map(x=>x.score))});
const paired=(a,b)=>{
 const bySeed=new Map(b.map(x=>[x.seed,x])),d=a.filter(x=>bySeed.has(x.seed)).map(x=>x.score-bySeed.get(x.seed).score),m=mean(d);
 const se=d.length>1?Math.sqrt(d.reduce((s,x)=>s+(x-m)**2,0)/(d.length-1)/d.length):null;
 return {n:d.length,pp:m===null?null:100*m,ci95:se===null?null:[100*(m-1.96*se),100*(m+1.96*se)],flipped:d.filter(x=>x!==0).length};
};
const metrics=xs=>({n:xs.length,pacePass:xs.filter(x=>x.pacePass).length,duration:{median:median(xs.map(x=>x.duration)),min:xs.length?Math.min(...xs.map(x=>x.duration)):null,max:xs.length?Math.max(...xs.map(x=>x.duration)):null},
 approach:median(xs.map(x=>x.approachMedian).filter(x=>x!==null)),separation:median(xs.map(x=>x.separationMedian).filter(x=>x!==null)),first:median(xs.map(x=>x.first).filter(x=>x!==null)),medianGap:median(xs.map(x=>x.medianGap).filter(x=>x!==null)),maxGap:xs.length?Math.max(...xs.map(x=>x.maxGap??0)):null,
 scrapeCount:xs.reduce((s,x)=>s+x.scrapeCount,0),scrapeSeconds:xs.reduce((s,x)=>s+x.scrapeDuration,0),rubs:xs.reduce((s,x)=>s+x.rubs,0),maxResidual:xs.length?Math.max(...xs.map(x=>x.residual)):null,
 actions:[0,1].map(i=>({press:mean(xs.map(x=>x.actions[i].press)),dash:mean(xs.map(x=>x.actions[i].dash)),perfect:mean(xs.map(x=>x.actions[i].perfect)),empty:mean(xs.map(x=>x.actions[i].empty)),dashEnd:Object.fromEntries(['full','glance','miss','blocked'].map(k=>[k,mean(xs.map(x=>x.actions[i].dashEnd[k]))]))})),
 failures:xs.filter(x=>!x.pacePass).map(x=>({seed:x.seed,duration:x.duration,first:x.first,medianGap:x.medianGap,maxGap:x.maxGap,reason:x.reason,replaySha256:x.replaySha256}))});
const comparisons=[],fairness=[],swaps=[],feel=[],causal=[];
for(const f of fixtures){
 for(const window of [.2,.25,.3]){
  const scene=rows.filter(x=>x.fixture===f.id&&x.window===window&&['primary','sensitivity'].includes(x.stage));
  const timing=scene.filter(x=>x.condition==='timing'),mash=scene.filter(x=>x.condition==='mash'),idle=scene.filter(x=>x.condition==='idle');
  comparisons.push({fixture:f.id,window,timing:rate(timing),mash:rate(mash),idle:rate(idle),timingMinusMash:paired(timing,mash),timingMinusIdle:paired(timing,idle),timingMetrics:metrics(timing),mashMetrics:metrics(mash),idleMetrics:metrics(idle)});
 }
 const fs=rows.filter(x=>x.fixture===f.id&&x.stage==='fair'),r=rate(fs);
 fairness.push({fixture:f.id,...r,pass:r.n===200&&r.score>=45&&r.score<=55,metrics:metrics(fs),byParity:[0,1].map(parity=>({parity,...rate(fs.filter(x=>x.seed%2===parity))}))});
 const swap=rows.filter(x=>x.fixture===f.id&&x.stage==='swap'),a=swap.filter(x=>x.condition==='flow-left'),b=swap.filter(x=>x.condition==='flow-right'),swapped=new Map(b.map(x=>[x.seed,x]));
 swaps.push({fixture:f.id,originalLeft:rate(a),swappedLeft:rate(b),sameStreamScoreBefore:percent(a.map(x=>x.score)),sameStreamScoreAfter:percent(b.map(x=>1-x.score)),paired:a.filter(x=>swapped.has(x.seed)).map(x=>({seed:x.seed,winnerBefore:x.winner,winnerAfter:swapped.get(x.seed).winner,mirrored:x.winner===null?swapped.get(x.seed).winner===null:swapped.get(x.seed).winner===1-x.winner}))});
 for(const mode of ['A','B']){
  const rs=rows.filter(x=>x.fixture===f.id&&x.stage==='feel'&&x.mode===mode),before=rs.filter(x=>x.version==='v12'),after=rs.filter(x=>x.version==='v13');
  feel.push({fixture:f.id,condition:'auto',mode,before:metrics(before),after:metrics(after),approachChange:median(after.map(x=>x.approachMedian))-median(before.map(x=>x.approachMedian)),separationChange:median(after.map(x=>x.separationMedian))-median(before.map(x=>x.separationMedian))});
 }
 const old=rows.filter(x=>x.fixture===f.id&&x.stage==='old-ai'),now=rows.filter(x=>x.fixture===f.id&&x.stage==='primary'&&x.condition==='timing');
 feel.push({fixture:f.id,condition:'timing',mode:'A',before:metrics(old),after:metrics(now),beforeRate:rate(old),afterRate:rate(now)});
 const cs=rows.filter(x=>x.fixture===f.id&&x.stage==='causal'),comparable=cs.filter(x=>x.countComparable);
 causal.push({fixture:f.id,n:cs.length,comparable:comparable.length,exactScore:percent(comparable.map(x=>x.exactScore)),delayedScore:percent(comparable.map(x=>x.score)),pp:percent(comparable.map(x=>x.exactScore-x.score)),excluded:cs.filter(x=>!x.countComparable).map(x=>({seed:x.seed,requested:x.requested,accepted:x.delayedAccepted}))});
}
const sensitivity=[.2,.25,.3].map(window=>({window,medianPP:median(comparisons.filter(x=>x.window===window).map(x=>x.timingMinusMash.pp))}));
const summary={fingerprint:manifest.fingerprint,rows:rows.length,planned:manifest.planned,complete:rows.length===manifest.planned,sensitivity,timingPass:sensitivity.find(x=>x.window===.25).medianPP>=15&&rows.length===manifest.planned,fairPass:fairness.every(x=>x.pass),comparisons,fairness,swaps,feel,causal};
await writeFile(new URL('summary.json',dir),JSON.stringify(summary,null,2)+'\n');
const pct=x=>Number.isFinite(x)?x.toFixed(1):'未跑',num=x=>Number.isFinite(x)?x.toFixed(2):'未跑';
let md='# 第13版固定样本对照\n\n默认挡窗0.25秒；同一固定对手、六种预先确定的装法，结论不能外推所有装法或真人。平局单列且计半分；差值区间是同种子配对的正态近似95%区间。\n\n';
md+='| 场景 | 挡窗 | 择时赢/局 | 乱按赢/局 | 择时−乱按(点，95%区间) | 不按赢/局 |\n|---|---:|---:|---:|---:|---:|\n';
for(const x of comparisons)md+=`| ${x.fixture} | ${x.window} | ${x.timing.wins}/${x.timing.n} | ${x.mash.wins}/${x.mash.n} | ${pct(x.timingMinusMash.pp)} (${x.timingMinusMash.ci95?.map(pct).join('～')??'未跑'}) | ${x.idle.wins}/${x.idle.n} |\n`;
md+='\n六场景差值中位：'+sensitivity.map(x=>`${x.window}秒 ${pct(x.medianPP)}点`).join('；')+'。默认15点线：'+(summary.timingPass?'通过':'未通过')+'。\n\n';
md+='| 同装法，两边都择时 | 左赢 | 平 | 超时 | 左侧得分率 | 45–55% |\n|---|---:|---:|---:|---:|---|\n';
for(const x of fairness)md+=`| ${x.fixture} | ${x.wins}/${x.n} | ${x.draws} | ${x.timeouts} | ${pct(x.score)}% | ${x.pass?'过':'未过'} |\n`;
md+='\n互换按键流只作座位偏差核查，不并进上表的公平样本；同装法、同种子，固定两条按键流在左右互换。\n\n| 场景 | 原左得分 | 互换后左得分 | 原按键流在左→右的得分 | 胜者随控制流镜像/配对 |\n|---|---:|---:|---:|---:|\n';
for(const x of swaps)md+=`| ${x.fixture} | ${pct(x.originalLeft.score)}% | ${pct(x.swappedLeft.score)}% | ${pct(x.sameStreamScoreBefore)}→${pct(x.sameStreamScoreAfter)}% | ${x.paired.filter(p=>p.mirrored).length}/${x.paired.length} |\n`;
md+='\n| 场景/模式 | 条件 | 20–40秒等节奏线，旧→新 | 时长中位，旧→新 | 撞前接近速度，旧→新 | 撞后分离速度，旧→新 |\n|---|---|---:|---:|---:|---:|\n';
for(const x of feel)md+=`| ${x.fixture}/${x.mode} | ${x.condition} | ${x.before.pacePass}/${x.before.n}→${x.after.pacePass}/${x.after.n} | ${num(x.before.duration.median)}→${num(x.after.duration.median)} | ${num(x.before.approach)}→${num(x.after.approach)} | ${num(x.before.separation)}→${num(x.after.separation)} |\n`;
md+='\n撞前速度取接触段第一次求解前的接触点法向相对速度；分离速度取撞后0.05–0.25秒质心距离变化，不把冲量当速度。逐局失败、刮蹭时长/次数、动作接纳数和原始完整SHA见summary.json/rounds.ndjson。\n\n';
md+='| 同一按键流整体延后0.25秒 | 次数可比/样本 | 原得分率 | 延后得分率 | 差(点) |\n|---|---:|---:|---:|---:|\n';
for(const x of causal)md+=`| ${x.fixture} | ${x.comparable}/${x.n} | ${pct(x.exactScore)} | ${pct(x.delayedScore)} | ${pct(x.pp)} |\n`;
md+='\n按键被冷却或提前结束吞掉的样本不用于解释时机收益；样本每场景仅10局，不能据此推真人水平。原始输入由种子与模拟重建，每条记录留输入SHA；重放原AI已接纳输入的逐帧物理SHA必须完全一致才纳入。\n';
await writeFile(new URL('../AUDIT.md',dir),md);console.log(JSON.stringify({rows:summary.rows,sensitivity,timingPass:summary.timingPass,fairPass:summary.fairPass,fairness:fairness.map(({fixture,score,pass})=>({fixture,score,pass}))},null,2));
