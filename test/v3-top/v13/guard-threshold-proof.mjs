// Elara 801b66b4 / 9648d295: prove the existing impulse gate, without editing production code.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {guardThresholdScenario,thresholdRules} from './guard-threshold-fixture.mjs';
import {root,sha} from './experiment.mjs';
const source=await readFile(new URL('sim/v3.js',root),'utf8');
let mutant=source;
const gate='Boolean(hit&&hit.impulse>=r.minimumImpulse&&t-lastSeen';
assert.equal(mutant.split(gate).length,2);
mutant=mutant.replace(gate,'Boolean(hit&&t-lastSeen');
mutant=mutant.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
for(const file of ['index.js','math.js'])mutant=mutant.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
mutant=mutant.replace("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
const point='const c=await loadCatalogRules(),r=await loadV3Rules();';assert.equal(mutant.split(point).length,2);
mutant=mutant.replace(point,point+`r.maxDuration=${thresholdRules.maxDuration};r.top.spinRate=0;`);
const simulate=(await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'))).simulateV3;
const actual=await guardThresholdScenario(),negative=await guardThresholdScenario(simulate);
const results=x=>x.replay.events.filter(e=>e.type==='blockResult');
assert.equal(results(actual)[0].resolvedStep,125);
assert.equal(results(negative)[0].resolvedStep,124,'negative control must consume the window on the weak touch');
const proof={sourceSha256:sha(source),productionChanged:false,
 fixture:'Injected manifold impulse 0.0005 at step 124; unmodified real Rapier impact at step 125. Only maxDuration=1.3 and spinRate=0 are overridden in memory.',
 minimumImpulse:actual.replay.meta.rules.minimumImpulse,samples:actual.samples,
 actualResults:results(actual),negativeControl:{change:'Remove only the impulse check from newEpisode in an in-memory module',results:results(negative)},
 actualReplaySha256:sha(actual.replay),negativeReplaySha256:sha(negative.replay)};
assert.equal(sha(await readFile(new URL('sim/v3.js',root))),proof.sourceSha256);
await writeFile(new URL('guard-threshold-proof.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));
