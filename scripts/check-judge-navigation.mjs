// Local-only release gate; #万物对战:8962d218, corrected by Elara 8f6791c8 / f32ed568.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
// The ladder's second opponent, the one the first win over 狂冲 unlocks (data/foes.json order).
const secondFoe=JSON.parse(await readFile(new URL('../data/foes.json',import.meta.url))).foes[1].name;
const build=path.resolve(process.argv[2]??'web/dist-judge-position');
assert((await stat(path.join(build,'index.html'))).isFile(),'Pass the built judge directory');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.glb':'model/gltf-binary','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.mp3':'audio/mpeg'};
const server=createServer(async(req,res) => {
 try {
  const file=path.resolve(build,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
  if(!file.startsWith(build+path.sep)) {res.writeHead(403).end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(await readFile(file));
 } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,report=[];
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 for(const width of [360,390,430]) {
  console.log(JSON.stringify({width,checkpoint:'begin'}));
  const context=await browser.newContext({viewport:{width,height:700},hasTouch:true,isMobile:true});
  try {
   const page=await context.newPage(),errors=[],api=[];
   page.setDefaultTimeout(30000);page.on('pageerror',e => errors.push(e.message));
   page.on('console',m => {if(m.type()==='error') console.error(m.text());});
   page.on('response',r => {if(r.status()>=400) console.error('HTTP',r.status(),r.url());});
   await page.route('**/*',route => {
    const url=new URL(route.request().url());
    if(url.origin!==origin || url.pathname.startsWith('/api/')) {api.push(url.pathname);return route.abort();}
    return route.continue();
   });
   await page.addInitScript(() => {window.__freshStorage=localStorage.length;});
   await page.goto(origin+'/?shoot=fake&shootSpeed=32&seed=803');
   await page.locator('#introGo:enabled').waitFor().catch(async error => {console.error(JSON.stringify({errors,api,text:await page.locator('body').innerText()}));throw error;});
   assert.equal(await page.evaluate(() => window.__freshStorage),0,'Fresh save');
   const welcome=async() => {for(const id of ['introGo','introPvp']) await page.locator('#'+id).waitFor({state:'visible'});};
   const state=() => page.evaluate(() => window.__top.status());
   const phase=value => page.waitForFunction(value => window.__top?.status().phase===value,value);
   const choose=async pvp => {
    await page.locator(pvp?'#introPvp':'#introGo').tap();await page.locator('#intro').waitFor({state:'hidden'});await phase('build');
    await page.waitForFunction(pvp => window.__top.status().pvp===pvp&&!document.querySelector('#goBtn').disabled,pvp);
   };
   const reachable=async() => {
    for(const button of await page.getByRole('button',{name:'回首页',exact:true}).all()) {
     if(!await button.isVisible()) continue;
     if(await button.evaluate(el => {const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})) return button;
    }
    return null;
   };
   const waitHome=() => page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => {
    if(el.textContent.trim()!=='回首页') return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
   }),null,{timeout:5000});
   const settledApp=() => page.locator('#app').evaluate(el => {
    // 2P's bench rotates for .4s. A hit-test during that rotation is transient.
    el.getBoundingClientRect();
    return Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
   });
   const goHome=async(screen,fallback) => {
    console.log(JSON.stringify({width,checkpoint:screen}));
    await settledApp();
    if(!fallback) await waitHome();
    const button=await reachable();
    if(button) {await button.tap();await welcome();report.push({width,screen,home:true});}
    else {
     assert(fallback,`${width}px ${screen}: no direct route home`);
     // A child page uses its real visible back key, then the bench's home: at most two taps. 2P's turn has only 回 1P
     // (Pollux acbd091c, Elara 0f310068), so there home is one tap more: each fallback is a back key in turn.
     const keys=[fallback].flat();
     for(const key of keys) {const backKey=key();assert(await backKey.isVisible(),screen+' visible back key');await backKey.tap();await settledApp();}
     await waitHome();
     const back=await reachable();assert(back,screen+': back must expose home in one tap');
     await back.tap();await welcome();report.push({width,screen,home:true,taps:keys.length+1});
    }
   };
   await welcome();report.push({width,screen:'welcome',modes:true});
   await choose(false);await goHome('solo-build');
   await choose(false);await page.locator('[data-pick="0"]').tap();await page.locator('#library').waitFor({state:'visible'});
   await goHome('solo-library',() => page.locator('#libBack'));
   await choose(false);await page.locator('#benchShoot').tap();await page.locator('#shootView').waitFor({state:'visible'});
   await goHome('photo-chooser',() => page.locator('#shootBack'));
   await choose(false);await page.locator('#benchShoot').tap();
   const png=await page.evaluate(() => {const c=document.createElement('canvas');c.width=c.height=256;return c.toDataURL().split(',')[1];});
   const photo={name:'navigation-fixture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
   await page.locator('#shootAlbum').setInputFiles(photo);await page.locator('button[data-act="submit"]').waitFor({state:'visible'});
   await goHome('photo-confirm',() => page.locator('#shootBack'));
   await choose(false);await page.locator('#benchShoot').tap();await page.locator('#shootAlbum').setInputFiles(photo);
   await page.locator('button[data-act="submit"]').tap();await page.locator('button[data-act="equip"]').waitFor({state:'visible',timeout:30000});
   await goHome('photo-ready',() => page.locator('#shootBack'));
   const noFightHome=async screen => {
    console.log(JSON.stringify({width,checkpoint:screen}));
    await page.evaluate(() => window.__top.freeze());assert.equal(await reachable(),null,screen+' hides home');
    const before=(await state()).phase;await page.locator('#homeBtn').evaluate(el => el.click());
    assert.equal((await state()).phase,before,screen+' handler refuses home');
    assert.equal(await page.locator('#intro').isVisible(),false,screen+' stays out of welcome');
    await page.evaluate(() => window.__top.release());report.push({width,screen,homeHidden:true,handlerRefused:true});
   };
   const fight=async pvp => {
    await page.locator('#goBtn').tap();await phase('play');
    // A fresh phone's first 狂冲 opens with the lesson (Elara 534cbd22), four stops each waiting for its lit button. At
    // 390 it is gone through with the button each card is about pressed once just before it (Elara 8b471471, d2999ce8):
    // 冲 at the start and after 知道了, 挡 after stop 2, 反打 as soon as it lights; all four cards must still come.
    if(!pvp&&width===390) {
     // Every press is a real one at the key's middle on screen, held 60 ms, after checking that the middle lands on the key:
     // a layer over a lit key (the veil over 冲, Sol aa052007) fails here instead of being stepped around.
     if(!page.__realPress) {page.__realPress=true;await page.exposeFunction('__realPress',async (x,y) => {await page.mouse.move(x,y);await page.mouse.down();await new Promise(r => setTimeout(r,60));await page.mouse.up();});}
     const cards=await page.evaluate(() => new Promise(resolve => {
      const $=id => document.getElementById(id),teach=$('teach'),order=['intro','dash','block','counter'],early=[],seen=[],covered=[];
      const press=el => {
       const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
       if(!hit||!(hit===el||el.contains(hit))) {covered.push(`${el.id} under ${hit?.id||hit?.getAttribute('class')||hit?.tagName||'nothing'}`);return false;}
       window.__realPress(x,y);return true;
      };
      const key=kind => kind==='intro'?$('teachOk'):kind==='block'?$('blockBtn'):$('dashBtn');
      let next=0,busy=false,pressed=null,pressedAt=0;
      const tick=() => {
       let kind=teach.hidden?null:teach.dataset.kind;const s=window.__top.status();
       // A real press lands a few ms later: the card it answered is still up until then.
       if(kind&&kind===pressed) {kind=null;busy=true;if(performance.now()-pressedAt>3000) covered.push(`${pressed}: the press did not close the card`);}
       else if(pressed&&kind!==pressed) pressed=null,busy=false;
       if(covered.length||!s.teach||s.phase!=='play'||next===order.length) {resolve({seen,early,covered});return;}
       if(kind&&!busy) {
        if(kind!==order[next]) {seen.push(kind);resolve({seen,early,covered});return;}
        seen.push(kind);busy=true;
        setTimeout(() => {if(press(key(kind))) {next++;pressed=kind;pressedAt=performance.now();} else busy=false;},250);
       } else if(!kind&&!busy&&!early[next]) {
        const want=order[next];
        if(want!=='counter'||$('dashBtn').classList.contains('counter')) early[next]=press(want==='block'?$('blockBtn'):$('dashBtn'));
       }
       requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
     }));
     assert.deepEqual(cards.covered,[],`${width}px: each lit key of the lesson takes a real press at its middle`);
     assert.deepEqual(cards.seen,['intro','dash','block','counter'],`${width}px: every stop of the lesson after an early press`);
     assert.equal(cards.early.filter(Boolean).length,4,`${width}px: an early press before each card`);
     report.push({width,screen:'solo-teach-early',cards:cards.seen});
    }
    await noFightHome(pvp?'pvp-fight':'solo-fight');
    if(!pvp&&width!==390){const skip=page.locator('#teachSkip');await skip.waitFor({state:'visible'});await skip.tap();await page.locator('#teach').waitFor({state:'hidden'});report.push({width,screen:'solo-teach-skip'});}
    await page.evaluate(() => window.__top.trackSafe(14));await phase('result');
    if(!pvp&&width===390) {
     // Stop 4's 反打 lands as the counter: our next 冲 blow inside the lesson 完美's stun (guardStun, 1 s).
     const landed=await page.evaluate(() => {
      const ev=window.__top.events(),perfect=ev.find(e => e.type==='blockResult'&&e.side===0&&e.outcome==='perfect');
      const blow=perfect&&ev.find(e => e.t>perfect.t&&e.role==='attack'&&e.attacker===0&&e.damage>0);
      return Boolean(blow?.dash&&blow.t-perfect.t<1-1e-6);
     });
     assert(landed,`${width}px: stop 4's 反打 lands as the counter`);
    }
    const replay=page.locator('#replayBtn');assert(await replay.isVisible(),'A replayable collision');
    await replay.tap();await phase('replay');await noFightHome(pvp?'pvp-replay':'solo-replay');await phase('result');
    await goHome(pvp?'pvp-result':'solo-result');
   };
   await choose(false);await fight(false);
   // Won on a 反打, then 迎战<next> and 开打 (Wren b7e0e2df): the match ends with the counter window open and the result
   // screen still reads its buttons; the next foe's fight must start, page error free.
   console.log(JSON.stringify({width,checkpoint:'solo-counter-win'}));
   await choose(false);const foe=await page.locator('#foeLabel').innerText();
   await page.evaluate(() => {window.__top.counterBot();window.__top.trackSafe(14);});
   await page.locator('#goBtn').tap();await phase('play');await phase('result');await page.evaluate(() => window.__top.counterBot(false));
   const end=await page.evaluate(() => {
    const ev=window.__top.events(),{winner}=window.__top.status().meta;
    const blow=ev.findLast(e => e.role==='attack'&&e.damage>0&&e.target===1&&e.targetPart==='core'),perfect=ev.findLast(e => e.type==='blockResult'&&e.side===0&&e.outcome==='perfect'&&e.t<=blow?.t);
    // countering(): the foe still stunned by our 完美 (guardStun, 1 s).
    return {winner,counter:Boolean(blow?.attacker===0&&blow.dash&&perfect&&blow.t-perfect.t<1-1e-6)};
   });
   assert.deepEqual(end,{winner:0,counter:true},`${width}px: the scripted fight must be won on a 反打 (pick another seed if the ladder changed)`);
   const again=page.locator('#againBtn');assert.equal(await again.innerText(),`迎战${secondFoe}`,'the yellow key names the next foe (Elara 2e1d0976)');assert.match(await page.locator('#unlockCard').innerText(),new RegExp(`新解锁\\s*${secondFoe}`),'the first win shows what it unlocks');await again.tap();await phase('build');
   await page.waitForFunction(() => !document.querySelector('#goBtn').disabled);
   const next=await page.locator('#foeLabel').innerText();assert.notEqual(next,foe,'迎战<next> brings the next foe');
   await page.locator('#goBtn').tap();await phase('play');await noFightHome('solo-next-fight');
   report.push({width,screen:'solo-counter-next',foe,next});
   await page.evaluate(() => window.__top.trackSafe(14));await phase('result');await goHome('solo-next-result');
   await choose(true);await goHome('pvp-1p-build');
   await choose(true);await page.locator('[data-pick="0"]').tap();await page.locator('#library').waitFor({state:'visible'});
   await goHome('pvp-1p-library',() => page.locator('#libBack'));
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);await goHome('pvp-2p-build',() => page.locator('#pvpBack'));
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);
   await page.locator('[data-pick="0"]').tap();await page.locator('#library').waitFor({state:'visible'});
   await goHome('pvp-2p-library',[() => page.locator('#libBack'),() => page.locator('#pvpBack')]);
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);await fight(true);
   await choose(false);assert.equal((await state()).pvp,false);await goHome('solo-again');
   assert.deepEqual(api,[],'Fake album path makes zero backend/external requests');assert.deepEqual(errors,[],'No page errors');
  } finally {await context.close();}
 }
 console.log(JSON.stringify({build,report,passed:true},null,2));
} finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
