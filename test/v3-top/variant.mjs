// Test-only: load sim/v3.js with rule overrides deep-merged in memory (for tuning sweeps).
// Never edits the shipping rules file. Same patch point as test/v3/rules-variant.mjs.
import {readFile} from 'node:fs/promises';
export async function simulateWithRules(overrides) {
  let source = await readFile(new URL('../../sim/v3.js', import.meta.url), 'utf8');
  source = source.replaceAll("'@dimforge/rapier3d-compat'", JSON.stringify(new URL('../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url).href));
  for (const file of ['index.js', 'math.js']) source = source.replaceAll(`'./${file}'`, JSON.stringify(new URL(`../../sim/${file}`, import.meta.url).href));
  source = source.replace("new URL('./v3-rules.json',import.meta.url)", `new URL(${JSON.stringify(new URL('../../sim/v3-rules.json', import.meta.url).href)})`);
  const target = 'const c=await loadCatalogRules(),r=await loadV3Rules();';
  if (source.split(target).length !== 2) throw Error('Rules variant patch no longer matches');
  const merge = 'const __merge=(a,b)=>{for(const[k,v]of Object.entries(b))if(v&&typeof v==="object"&&!Array.isArray(v)&&a[k]&&typeof a[k]==="object")__merge(a[k],v);else a[k]=v;return a;};';
  source = source.replace(target, target + merge + `__merge(r,${JSON.stringify(overrides)});`);
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).simulateV3;
}
