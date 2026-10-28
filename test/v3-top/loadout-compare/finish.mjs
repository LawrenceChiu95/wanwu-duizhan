// Run after run.mjs: nice -n 20 node test/v3-top/loadout-compare/finish.mjs
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {simulateV3} from '../../../sim/v3.js';
import {BASE, PAIRS, LAYOUTS, CONDITIONS, options, sha256, summarizeReplay, aggregate, median} from './compare.mjs';

const dir = new URL('./', import.meta.url), results = new URL('results/', dir);
const read = async f => JSON.parse(await readFile(new URL(f, results), 'utf8'));
const rows = (await readFile(new URL('rounds.ndjson', results), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
const summary = await read('summary.json'), inputs = await read('inputs.json');
for (const r of rows) {
  assert([0, 1, null].includes(r.winner));
  assert(r.duration > 0 && r.duration <= 60);
  assert(r.core.every(c => ['contacts','attackHits','recoilHits','damage'].every(k => Number.isFinite(c[k]) && c[k] >= 0)));
  if(r.condition === 'auto') assert(r.actions.every(c => c.dash === 0 && c.block === 0 && c.parry === 0));
}
const recomputed = aggregate(rows, inputs.seeds);
for (const k of Object.keys(recomputed)) assert.deepEqual(summary[k], recomputed[k]);
const smoke = (await readFile(new URL('smoke/rounds.ndjson', dir), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
for (const s of smoke) assert.equal(rows.find(r => r.condition === s.condition && r.pair === s.pair && r.layout === s.layout && r.seed === s.seed)?.replaySha256, s.replaySha256);

const pct = p => `${(100*p).toFixed(0)}%`, sec = n => n.toFixed(2);
const layoutName = id => {const [a,b,spread] = id.split('-');return `${a === 'out' ? '伸' : '贴'}/${b === 'out' ? '伸' : '贴'}·${spread === 'e180' ? '对面' : '挨着'}`;};
const conditionName = c => c === 'auto' ? '自动' : '冲挡电脑对电脑';
const who = side => side === 0 ? '我方' : '对手';
const itemNames = {'pan-lux3d':'锅', broom:'扫把', scissors:'剪刀', pillow:'枕头', 'lamp-lux3d':'台灯', slipper:'拖鞋', '__core':'核心'};
const breakText = fact => fact ? `${sec(fact.t)}s ${fact.broken.map(e=>`${who(e.side)}${itemNames[e.item]}`).join('＋')}` : '无碎件';
const firstMode = count => Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([key,n])=>`${key}×${n}`).join('；');
const paired = [];
for (const c of summary.comparisons) {
  const best = c.best[0], worst = c.worst[0];
  const a = rows.filter(r => r.condition===c.condition && r.pair===c.pair && r.layout===best);
  const b = rows.filter(r => r.condition===c.condition && r.pair===c.pair && r.layout===worst);
  const pairs = a.map(r=>[r,b.find(x=>x.seed===r.seed)]);
  paired.push({condition:c.condition,pair:c.pair,best,worst,
    bestWinWorstLoss:pairs.filter(([x,y])=>x.winner===0&&y.winner===1).length,
    bestLossWorstWin:pairs.filter(([x,y])=>x.winner===1&&y.winner===0).length,
    winIndicatorChanged:pairs.filter(([x,y])=>(x.winner===0)!==(y.winner===0)).length,
    outcomeChanged:pairs.filter(([x,y])=>x.winner!==y.winner).length});
}
await writeFile(new URL('paired.json', results),JSON.stringify(paired,null,2)+'\n');

// The first tied best/worst follows the predeclared layout enumeration. The seed
// picks a win/loss split nearest both cells' median durations, then the lowest seed.
// These are explanatory examples, not a replacement for all 100 paired seeds.
const samples=[]; await mkdir(new URL('samples/',dir),{recursive:true});
for (const pair of PAIRS) {
  const c=summary.comparisons.find(c=>c.condition==='auto'&&c.pair===pair.id);
  const best=LAYOUTS.find(l=>l.id===c.best[0]),worst=LAYOUTS.find(l=>l.id===c.worst[0]);
  const a=rows.filter(r=>r.condition==='auto'&&r.pair===pair.id&&r.layout===best.id);
  const b=rows.filter(r=>r.condition==='auto'&&r.pair===pair.id&&r.layout===worst.id);
  const ma=median(a.map(r=>r.duration)),mb=median(b.map(r=>r.duration));
  const choices=a.map(x=>{const y=b.find(y=>y.seed===x.seed);return {x,y,split:x.winner===0&&y.winner===1,score:Math.abs(x.duration-ma)+Math.abs(y.duration-mb)};});
  choices.sort((a,b)=>Number(b.split)-Number(a.split)||a.score-b.score||a.x.seed-b.x.seed);
  const chosen=choices[0], examples=[];
  for (const [kind,layout,expected] of [['best',best,chosen.x],['worst',worst,chosen.y]]) {
    const replay=await simulateV3(options(pair,layout,'auto',chosen.x.seed));
    assert.equal(sha256(replay),expected.replaySha256);
    const file=`${pair.id}-${kind}.json`;
    await writeFile(new URL(`samples/${file}`,dir),JSON.stringify(replay)+'\n');
    const mine=[pair.items[0],layout.orients[0],pair.items[1],layout.orients[1],layout.spread].join(',');
    examples.push({kind,layout:layout.id,file,url:`http://127.0.0.1:4330/?mine=${mine}&seed=${chosen.x.seed}`,
      ...summarizeReplay(replay,{pair,layout,condition:'auto',computeMs:null}),
      // Only observed event facts. A contact does not prove which visual change caused the outcome.
      timeline:replay.events.filter(e=>e.type==='break'||(['hit','weak'].includes(e.type)&&e.targetPart==='core'&&e.damage>0)).map(e=>({
        t:e.t,type:e.type,attacker:e.attacker,item:e.item,target:e.target,targetPart:e.targetPart,targetItem:e.targetItem,
        role:e.role,damage:e.damage,hpAfter:e.hpAfter,weak:e.weak}))});
  }
  samples.push({pair:pair.id,label:pair.label,seed:chosen.x.seed,split:chosen.split,examples});
}
await writeFile(new URL('samples/index.json',dir),JSON.stringify(samples,null,2)+'\n');
let sampleMd=`# 自动录屏样本\n\n冻结版本 ${BASE}，模式 A，对手固定为锅伸出／台灯贴着、对面。每对两条只改装法，种子相同；样本来自每格100局的最好／最差装法。并列时按预先枚举顺序取第一种，种子按两格典型时长选择；不是承诺每个种子都翻转。\n\n录屏只做自动，冲挡电脑对电脑仅报数。打开下面的本机地址（4330 当前已在服务，不要开旧4399），核两件东西、朝向和位置，再点“开打”。不要切手动、换物品或重新随机种子；URL带seed会固定。优先各录一段整局，再取碎件／核心命中附近，保留前后约2秒。发布页外层的查询串不会自动传给内嵌游戏，因此不用外层链接代替这些地址。\n\nWren先核游戏控制台 window.__top.status() 的 seed/mine，并在模拟完成后对 window.__top.replayJson() 原字符串做SHA256，与下表核对；不一致先停并找Sol，不替换录屏源或重新构建。Browser实际SHA回执见 browser-verification.json（有回执才算已验）。\n\n`;
for(const s of samples){sampleMd+=`## ${s.label}，同种子 ${s.seed}\n\n`;
  for(const e of s.examples) sampleMd+=`- ${e.kind==='best'?'最好':'最差'}：${layoutName(e.layout)}，${e.winner===0?'我方胜':e.winner===1?'我方负':'平局'}，${sec(e.duration)}秒；首碎 ${breakText(e.firstBreak)}；核心受击我/敌 ${e.core.map(c=>c.contacts).join('/')}（其中主攻命中 ${e.core.map(c=>c.attackHits).join('/')}）。[本机打开](${e.url})；完整回放 [${e.file}](${e.file})；SHA256 ${e.replaySha256}。\n`;
  sampleMd+='\n掉件与核心扣血的逐条时间线在 index.json；它记录“发生了什么”，装法为什么改变结果仍需实看，不能用时间先后冒充物理因果。\n\n';
}
await writeFile(new URL('samples/README.md',dir),sampleMd);

let detail=`# 完整对照\n\n冻结 main ${BASE}。模式A，固定对手：锅伸出e0、台灯贴着e180。每格同一组种子1–${inputs.seeds}，${summary.games}局，Node ${inputs.node}，nice ${inputs.nice}，单进程耗时 ${(summary.seconds/60).toFixed(2)}分钟。输入总SHA256 ${summary.inputSha256}。\n\n胜率为我方核心击碎对手的胜局/全部局，平局和到时不算赢。时长为游戏秒数；核心受击为造成正伤害的不同时间点数，反震包含在该数中，但另列主攻命中，持续刮蹭不算新撞击。同一次同时掉两件保留并列。下表首碎的0/1是我方/对手；全分布见summary.json/csv，不能把众数当每局都如此。\n\n`;
for(const condition of CONDITIONS){detail+=`## ${conditionName(condition)}\n\n|组合|装法（第一/第二）|胜/负/平|胜率（95%区间）|秒均值/中位|核心受击中位我/敌|主攻命中中位我/敌|全局先碎|我方先碎|对手先碎|\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for(const c of summary.cells.filter(c=>c.condition===condition)) detail+=`|${PAIRS.find(p=>p.id===c.pair).label}|${layoutName(c.layout)}|${c.wins}/${c.losses}/${c.draws}|${pct(c.winRate)}（${c.winRate95.map(pct).join('–')}）|${sec(c.duration.mean)}/${sec(c.duration.median)}|${c.core.map(x=>x.contacts.median).join('/')}|${c.core.map(x=>x.attackHits.median).join('/')}|${firstMode(c.firstBreak)}|${firstMode(c.firstOwnBreak)}|${firstMode(c.firstFoeBreak)}|\n`;
  const pass=summary.conditions.find(c=>c.condition===condition);detail+=`\n三对最优装法交集：${pass.universalBest.map(layoutName).join('、')||'空'}。本条件${pass.pass?'达到':'未达到'}约定数值线。\n\n`;
}
detail+='## 同种子配对\n\n|条件|组合|最好赢且最差输|反向翻转|胜负/平结果改变|\n|---|---|---|---|---|\n';
for(const p of paired)detail+=`|${conditionName(p.condition)}|${PAIRS.find(x=>x.id===p.pair).label}|${p.bestWinWorstLoss}/${inputs.seeds}|${p.bestLossWorstWin}/${inputs.seeds}|${p.outcomeChanged}/${inputs.seeds}|\n`;
detail+=`\n这是100个固定种子的描述统计；最好与最差也是从这100局选出，不能当独立留出样本上的显著性或对所有对手都成立。未换边、未测模式B、未调参；观感和“看得懂原因”交Wren/Elara。AI条件每格冲/挡/弹开均值在summary.json，AI输入不是真人操作。\n\n## 证据与复跑\n\n- run.mjs记录逐局回放SHA、首次碎件、核心命中、时长与冲挡，输入逐文件SHA在results/inputs.json；失败即抛出，不读旧批次补数。\n- 48局smoke与正式批次相同种子的完整回放SHA全部相同；本脚本从rounds.ndjson独立重算summary所有统计并核种子覆盖。六条录屏样本重新模拟，完整SHA与批次相同。\n- 单元测试覆盖反震与主攻区分、同时碎件、无碎件、平局分母、并列最优和种子缺口；当前4项通过。\n- 浏览器复放、当前差异范围与提交证据见VERIFICATION.md；尚未有的验收不得从自动数字推定。\n- 复跑：nice -n 20 node test/v3-top/loadout-compare/run.mjs 100 <新目录>。旧结果使用wx保护，不覆写。finish.mjs固定核本次results，并生成本报告及samples；复跑先自行指向新目录，不能混用。\n`;
await writeFile(new URL('AUDIT.md',dir),detail);

const stories = samples.map(s => {
  const [a,b]=s.examples;
  const pair=PAIRS.find(p=>p.id===s.pair);
  const plain=id=>{const l=LAYOUTS.find(l=>l.id===id);return pair.items.map((item,i)=>`${itemNames[item]}${l.orients[i]==='out'?'伸出':'贴着'}`).join('、')+`，两件${l.spread==='e180'?'装在对面':'挨着'}`;};
  const c=summary.comparisons.find(c=>c.condition==='auto'&&c.pair===s.pair);
  const survived=e=>e.firstBreakBySide[0] ? `${itemNames[e.firstBreakBySide[0].broken[0].item]}${sec(e.firstBreakBySide[0].t)}秒先碎` : '两件都保到终局';
  return `- **${s.label}（自动）**：最好是${plain(a.layout)}（${pct(c.bestRate)}）；最差是${plain(b.layout)}（${pct(c.worstRate)}）。种子${s.seed}里，最好装法${survived(a)}、核心遭主攻${a.core[0].attackHits}下，由${itemNames[a.decisive.attackerItem??'__core']}收尾赢；最差装法${survived(b)}、核心遭主攻${b.core[0].attackHits}下，输。`;
}).join('\n');
let result=`# 换装法对照\n\n${stories}\n\n以上是同种子录屏里的具体过程；不能据此把某一件当成固定护盾或保证每局都赢。\n\n**数值${summary.pass?'达到':'未达到'}全部门槛**。冻结 ${BASE.slice(0,7)}，三对×八种×自动/冲挡电脑对电脑×100同种子＝${summary.games}局；只换我方装法，对手、规则和物品不变。\n\n|条件|组合|最好 → 最差|胜率差|过20点线|\n|---|---|---|---|---|\n`;
for(const c of summary.comparisons)result+=`|${conditionName(c.condition)}|${PAIRS.find(p=>p.id===c.pair).label}|${pct(c.bestRate)} → ${pct(c.worstRate)}|${(100*c.spread).toFixed(0)}点|${c.pass?'过':'未过'}|\n`;
result+='\n';for(const c of summary.conditions)result+=`${conditionName(c.condition)}：三对共同最优装法${c.universalBest.length?'有 '+c.universalBest.map(layoutName).join('、'):'无'}；${c.pass?'过线':'未过线'}。\n\n`;
result+=`[48格完整表](AUDIT.md)、[CSV](results/summary.csv)、[逐局数据](results/rounds.ndjson)、[六条自动录屏样本与地址](samples/README.md)。批量${(summary.seconds/60).toFixed(2)}分钟，nice20单进程。48条smoke及6条样本与正式回放SHA一致，4项统计测试过；浏览器核验见[回执](VERIFICATION.md)。\n\n这些数只说明固定对手下换装改变胜负，不代替“看得出为什么”的录屏验收；100种子的区间和配对翻转数已列，未因结果换组合或调参数。正式sim/web/data未改，未构建、推送或合main。Elara 550a8a30已接受当前数值边界：冲挡剪刀＋枕头14点如实留MVP平衡，本次不调。交Elara审工具与交付，Wren只录自动六条；AI条件不录屏。\n`;
await writeFile(new URL('RESULT.md',dir),result);
console.log(JSON.stringify({games:rows.length,smokeIdentical:smoke.length,samplesIdentical:6,pass:summary.pass,comparisons:summary.comparisons,conditions:summary.conditions}));
