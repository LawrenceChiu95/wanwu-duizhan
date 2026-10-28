import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PAIRS,LAYOUTS,median,sha256,wilson} from '../loadout-compare/compare.mjs';
const source=new URL('../loadout-compare/results/',import.meta.url),out=new URL('./',import.meta.url);
const old=JSON.parse(await readFile(new URL('inputs.json',source))),root=new URL('../../../',import.meta.url);
for(const [f,sha] of Object.entries(old.sources).filter(([p])=>/^(sim|data)\//.test(p)))assert.equal(sha256(await readFile(new URL(f,root))),sha,f);
const rows=(await readFile(new URL('rounds.ndjson',source),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,4800);
function pairStats(a,b,label){
 assert.equal(a.length,b.length);const sorted=xs=>[...xs].sort((x,y)=>x.seed-y.seed);a=sorted(a);b=sorted(b);
 assert.deepEqual(a.map(x=>x.seed),b.map(x=>x.seed));assert.equal(new Set(a.map(x=>x.seed)).size,a.length);
 const n=a.length,ds=a.map((x,i)=>Number(b[i].winner===0)-Number(x.winner===0)),delta=ds.reduce((s,x)=>s+x,0)/n;
 const variance=ds.reduce((s,x)=>s+(x-delta)**2,0)/(n-1),se=Math.sqrt(variance/n);
 const flips=a.filter((x,i)=>(x.winner===0)!==(b[i].winner===0)).length,changed=a.filter((x,i)=>x.winner!==b[i].winner).length;
 const wins=xs=>xs.filter(x=>x.winner===0).length;
 return {label,n,aWins:wins(a),bWins:wins(b),aDraws:a.filter(x=>x.winner===null).length,bDraws:b.filter(x=>x.winner===null).length,
  aRate:wins(a)/n,bRate:wins(b)/n,deltaPp:delta*100,delta95Pp:[Math.max(-1,delta-1.96*se)*100,Math.min(1,delta+1.96*se)*100],
  gain:ds.filter(x=>x===1).length,loss:ds.filter(x=>x===-1).length,winStatusFlips:flips,flipRate:flips/n,flip95:wilson(flips,n),winnerChanged:changed};
}
const synthetic=[{seed:1,winner:0},{seed:2,winner:1},{seed:3,winner:null}];
const check=pairStats(synthetic,[{seed:1,winner:1},{seed:2,winner:0},{seed:3,winner:null}],'test');assert.equal(check.deltaPp,0);assert.equal(check.winStatusFlips,2);
const cell=(condition,pair,layout)=>rows.filter(r=>r.condition===condition&&r.pair===pair&&r.layout===layout);
const comparisons=[],ranges=[];
for(const condition of ['ai-ai','auto']){
 for(const p of PAIRS){
  const cells=LAYOUTS.map(l=>({id:l.id,rate:cell(condition,p.id,l.id).filter(r=>r.winner===0).length/100}));
  ranges.push({condition,pair:p.id,cells,rangePp:(Math.max(...cells.map(x=>x.rate))-Math.min(...cells.map(x=>x.rate)))*100});
  for(let dim=0;dim<3;dim++)for(let i=0;i<LAYOUTS.length;i++){
   const j=i^([4,2,1][dim]);if(j<i)continue;
   comparisons.push({factor:['first-orient','second-orient','spread'][dim],condition,pair:p.id,...pairStats(cell(condition,p.id,LAYOUTS[i].id),cell(condition,p.id,LAYOUTS[j].id),`${p.id}:${LAYOUTS[i].id}->${LAYOUTS[j].id}`)});
  }
 }
 for(const l of LAYOUTS)for(let i=0;i<PAIRS.length;i++)for(let j=i+1;j<PAIRS.length;j++)comparisons.push({factor:'items',condition,layout:l.id,...pairStats(cell(condition,PAIRS[i].id,l.id),cell(condition,PAIRS[j].id,l.id),`${l.id}:${PAIRS[i].id}->${PAIRS[j].id}`)});
}
let additional=[];
try{additional=(await readFile(new URL('results/rounds.ndjson',out),'utf8')).trim().split('\n').map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
if(additional.length){
 const done=JSON.parse(await readFile(new URL('results/complete.json',out)));assert.equal(done.complete,3600);assert.equal(additional.length,3600);
 for(const condition of [...new Set(additional.map(r=>r.condition))])for(const fixture of [...new Set(additional.map(r=>r.fixture))]){
  const b=additional.filter(r=>r.condition===condition&&r.fixture===fixture);assert.equal(b.length,100);
  const a=b.map(r=>({seed:r.seed,winner:r.baselineWinner}));
  comparisons.push({factor:condition,condition:'ai-ai',fixture,...pairStats(a,b,fixture)});
 }
 // Also compare mash directly with idle, always leaving the opponent AI unchanged.
 for(const fixture of [...new Set(additional.map(r=>r.fixture))])comparisons.push({factor:'mash-vs-idle',condition:'ai-ai',fixture,...pairStats(additional.filter(r=>r.condition==='idle'&&r.fixture===fixture),additional.filter(r=>r.condition==='mash'&&r.fixture===fixture),fixture)});
}
const summary=[];
for(const condition of ['ai-ai','auto'])for(const factor of [...new Set(comparisons.map(r=>r.factor))]){
 const rs=comparisons.filter(r=>r.condition===condition&&r.factor===factor);if(!rs.length)continue;
 const abs=rs.map(r=>Math.abs(r.deltaPp)),flips=rs.map(r=>r.flipRate*100);
 summary.push({condition,factor,groups:rs.length,nPerGroup:rs[0].n,medianAbsDeltaPp:median(abs),minAbsDeltaPp:Math.min(...abs),maxAbsDeltaPp:Math.max(...abs),
  minSignedDeltaPp:Math.min(...rs.map(r=>r.deltaPp)),maxSignedDeltaPp:Math.max(...rs.map(r=>r.deltaPp)),medianFlipPp:median(flips),minFlipPp:Math.min(...flips),maxFlipPp:Math.max(...flips),
  approx95ExcludesZero:rs.filter(r=>r.delta95Pp[0]>0||r.delta95Pp[1]<0).length});
}
await mkdir(out,{recursive:true});await writeFile(new URL('analysis.json',out),JSON.stringify({oldGames:rows.length,newGames:additional.length,originalInputSha256:old.inputSha256,ranges,summary,comparisons},null,2)+'\n');
console.log(JSON.stringify({oldGames:rows.length,newGames:additional.length,ranges:ranges.map(({condition,pair,rangePp})=>({condition,pair,rangePp})),summary},null,2));
