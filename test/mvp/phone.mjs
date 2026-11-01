import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from '../../web/node_modules/playwright/index.mjs';
import {simulateV3} from '../../sim/v3.js';
import {createHash} from 'node:crypto';
const out=new URL('./phone/',import.meta.url);await mkdir(out,{recursive:true});
const engine=process.env.MVP_BROWSER??'chrome',b=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
const sha=x=>createHash('sha256').update(x).digest('hex');
try{
 const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:1}),errors=[];
 p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('http://127.0.0.1:4406/?seed=37&mine=pan-lux3d,out,broom,out,e180&foe=pan-lux3d,out,broom,hug,e180',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__top?.status().phase==='build',null,{polling:100,timeout:30000});
 await p.screenshot({path:new URL(`${engine}-build.png`,out).pathname});
 await p.evaluate(()=>{
  window.render_game_to_text=()=>JSON.stringify(window.__top.status()); // bridge existing test state, no shipped UI change
  window.__mvpSamples=[];window.__mvpInitialSweep=null;
  window.__top.trackSafe(1);
  let last=-1;
  const tick=()=>{const t=window.__top.status();if(t.phase==='play'&&t.t!==last){
   last=t.t;const stage=window.__top.stage;
   window.__mvpInitialSweep??=stage.fighters.map(f=>f.sweep);
   window.__mvpSamples.push({t:t.t,diameters:stage.fighters.map((f,i)=>2*stage.screenRadius(f.center,window.__mvpInitialSweep[i]))});
  }requestAnimationFrame(tick);};requestAnimationFrame(tick);
 });
 await p.locator('#goBtn').click();
 await p.waitForFunction(()=>window.__top.status().phase==='play',null,{polling:100,timeout:30000});
 await p.waitForTimeout(650);await p.locator('#dashBtn').dispatchEvent('pointerdown');await p.locator('#dashBtn').dispatchEvent('pointerup');
 await p.waitForTimeout(650);await p.locator('#blockBtn').dispatchEvent('pointerdown');await p.locator('#blockBtn').dispatchEvent('pointerup');
 await p.screenshot({path:new URL(`${engine}-fight.png`,out).pathname});
 await p.waitForFunction(()=>window.__top.status().phase==='result',null,{polling:200,timeout:180000});
 const state=await p.evaluate(()=>({status:window.__top.status(),samples:window.__mvpSamples,safe:window.__top.safe(),framing:window.__top.framing(),replay:window.__top.replayJson()}));
 await p.screenshot({path:new URL(`${engine}-result.png`,out).pathname});
 const r=JSON.parse(state.replay),again=await simulateV3({fighters:r.meta.initial.map(f=>f.definition),seed:r.meta.seed,mode:r.meta.mode,manual:r.meta.manual});
 assert.equal(sha(state.replay),sha(JSON.stringify(again)),'actual page inputs must re-simulate identically in Node');assert.deepEqual(errors,[]);
 const median=xs=>{const a=xs.toSorted((a,b)=>a-b);return (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
 const report={engine,userAgent:await p.evaluate(()=>navigator.userAgent),viewport:{width:390,height:844,deviceScaleFactor:1},cam:state.status.cam,duration:r.meta.duration,firstDamage:r.events.find(e=>e.damage>0)?.t??null,diameters:[0,1].map(i=>({median:median(state.samples.map(s=>s.diameters[i])),min:Math.min(...state.samples.map(s=>s.diameters[i]))})),samples:state.samples.length,winner:r.meta.winner,accepted:r.meta.manual.inputs,byteEqual:true,replaySha256:sha(state.replay),safe:state.safe,framing:state.framing,errors};
 await writeFile(new URL(`${engine}-proof.json`,out),JSON.stringify(report,null,2)+'\n');await writeFile(new URL(`${engine}-samples.json`,out),JSON.stringify(state.samples)+'\n');await writeFile(new URL(`${engine}-replay.json`,out),state.replay);
 console.log(JSON.stringify(report));
 await p.locator('#againBtn').click();assert.equal(await p.evaluate(()=>window.__top.status().phase),'build');
}finally{await b.close();}
