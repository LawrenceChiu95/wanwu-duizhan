// Test-only isolated module. Never edits the shipping rules file or public API.
import{readFile}from'node:fs/promises';
export async function simulateWithRules(overrides){
 let source=await readFile(new URL('../../sim/v3.js',import.meta.url),'utf8');
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',import.meta.url).href));
 for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`../../sim/${file}`,import.meta.url).href));
 source=source.replace("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('../../sim/v3-rules.json',import.meta.url).href)})`);
 const target='const c=await loadCatalogRules(),r=await loadV3Rules();';if(source.split(target).length!==2)throw Error('Rules variant patch no longer matches');
 source=source.replace(target,target+`Object.assign(r,${JSON.stringify(overrides)});`);
 return(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).simulateV3;
}
