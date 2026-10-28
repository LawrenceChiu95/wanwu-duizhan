// Test-only in-memory intervention loader. Shipping files are never edited.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
export async function loadExperiment(kind = 'baseline') {
 let source = await readFile(new URL('sim/v3.js', root), 'utf8');
 const once = (from, to) => {assert.equal(source.split(from).length, 2, `patch point ${from}`); source = source.replace(from, to);};
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
 once("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
 if(kind==='initial')once('const rng=random(seed);','const rng=random((seed+10000)>>>0);');
 else if(kind==='critical')once('critRoll=random(seed^0x9e3779b9);','critRoll=random(((seed+10000)>>>0)^0x9e3779b9);');
 else if(kind==='ai-random')once('aiRng=[random((seed^0x2545f491)>>>0),random((seed^0x68e31da4)>>>0)]',
 'aiRng=[random((((seed+10000)>>>0)^0x2545f491)>>>0),random((((seed+10000)>>>0)^0x68e31da4)>>>0)]');
 else if(kind==='right-yaw')once('const q=quatFromRotationVector(tilt);body.setRotation',
 'let q=quatFromRotationVector(tilt);if(index===1)q=[-q[2],q[3],q[0],-q[1]];body.setRotation');
 else assert.equal(kind,'baseline');
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
