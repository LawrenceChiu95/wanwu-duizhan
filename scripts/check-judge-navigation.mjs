// Local-only release gate; #万物对战:8962d218, corrected by Elara 8f6791c8 / f32ed568.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
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
   const goHome=async(screen,fallback) => {
    console.log(JSON.stringify({width,checkpoint:screen}));
    if(!fallback) await waitHome();
    const button=await reachable();
    if(button) {await button.tap();await welcome();report.push({width,screen,home:true});}
    else {
     assert(fallback,`${width}px ${screen}: no direct route home`);
     // A child page uses its real visible back key, then the bench's home: at most two taps.
     const backKey=fallback();assert(await backKey.isVisible(),screen+' visible back key');await backKey.tap();
     await waitHome();
     const back=await reachable();assert(back,screen+': back must expose home in one tap');
     await back.tap();await welcome();report.push({width,screen,home:true,taps:2});
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
    await page.locator('#goBtn').tap();await phase('play');await noFightHome(pvp?'pvp-fight':'solo-fight');
    await page.evaluate(() => window.__top.trackSafe(14));await phase('result');
    const replay=page.locator('#replayBtn');assert(await replay.isVisible(),'A replayable collision');
    await replay.tap();await phase('replay');await noFightHome(pvp?'pvp-replay':'solo-replay');await phase('result');
    await goHome(pvp?'pvp-result':'solo-result');
   };
   await choose(false);await fight(false);
   await choose(true);await goHome('pvp-1p-build');
   await choose(true);await page.locator('[data-pick="0"]').tap();await page.locator('#library').waitFor({state:'visible'});
   await goHome('pvp-1p-library',() => page.locator('#libBack'));
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);await goHome('pvp-2p-build');
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);
   await page.locator('[data-pick="0"]').tap();await page.locator('#library').waitFor({state:'visible'});
   await goHome('pvp-2p-library',() => page.locator('#libBack'));
   await choose(true);await page.locator('#goBtn').tap();await page.waitForFunction(() => window.__top.status().pick===1);await fight(true);
   await choose(false);assert.equal((await state()).pvp,false);await goHome('solo-again');
   assert.deepEqual(api,[],'Fake album path makes zero backend/external requests');assert.deepEqual(errors,[],'No page errors');
  } finally {await context.close();}
 }
 console.log(JSON.stringify({build,report,passed:true},null,2));
} finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
