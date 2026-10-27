import {chromium}from'../../web/node_modules/playwright/index.mjs';
import{writeFile}from'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:4488/test/v3/browser-check.html');
 await page.waitForFunction(()=>window.verification,{timeout:60000});
 const proof=await page.evaluate(()=>window.verification);proof.pageErrors=errors;
 await writeFile('test/v3/browser.json',JSON.stringify(proof,null,2)+'\n');await page.screenshot({path:'test/v3/browser.png',fullPage:true});
 if(proof.error||errors.length)throw Error(JSON.stringify(proof));console.log(JSON.stringify(proof));
}finally{await browser.close();}
