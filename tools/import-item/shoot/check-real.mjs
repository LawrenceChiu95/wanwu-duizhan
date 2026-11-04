import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
const {values} = parseArgs({args: process.argv.slice(2), options: {photo: {type: 'string'}, key: {type: 'string'}, 'allow-paid': {type: 'boolean', default: false}}});
if (!values['allow-paid'] || !values.photo || !path.isAbsolute(values.photo) || !/^[A-Za-z0-9_-]{8,128}$/.test(values.key ?? '')) throw Error('Use --photo /absolute/photo.jpg --key stable-key --allow-paid after Lead approves the cost');
// The CLI is another browser: retain its private session across observations.
const sessionFile = new URL('../../../.aholo/shoot-client-cookie.json', import.meta.url);
let cookie = '';
try { cookie = JSON.parse(await fs.readFile(sessionFile, 'utf8')).cookie; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const base = 'http://127.0.0.1:4408/api/shoot/';
async function get(route, options = {}) {
  const response = await fetch(base + route, {...options, headers: {...options.headers, ...(cookie ? {cookie} : {})}, signal: AbortSignal.timeout(10000)});
  const reply = await response.json();
  if (!response.ok) throw Error(`Local backend refused: ${reply.error?.code ?? response.status}; keep the same key, do not regenerate`);
  if (route === 'quota' && reply.provider !== 'real') throw Error('Backend is not the real provider; no photo submitted');
  const saved = response.headers.get('set-cookie')?.split(';')[0];
  if (saved && saved !== cookie) {
    cookie = saved;
    await fs.mkdir(new URL('./', sessionFile), {recursive: true});
    await fs.writeFile(sessionFile, JSON.stringify({cookie}), {mode: 0o600});
  }
  return reply;
}
await get('quota');
const bytes = await fs.readFile(values.photo), form = new FormData();
form.append('photo', new Blob([bytes]), 'photo'); form.append('clientKey', values.key);
let {job} = await get('jobs', {method: 'POST', body: form});
const id = job.id, deadline = Date.now() + 45 * 60 * 1000;
let previous;
while (!['succeeded', 'failed'].includes(job.status)) {
  const stage = job.status === 'recognizing' ? 'recognizing' : job.steps.find(s => !s.endedAt)?.key;
  if (stage !== previous) { console.log(JSON.stringify({job: id, stage})); previous = stage; }
  if (Date.now() >= deadline) throw Error(`Observation timed out, NOT a job failure. Original job ${id} and clientKey remain; re-run with the SAME absolute photo and key to read the same job, without a second submission charge`);
  await pause(2000); ({job} = await get(`jobs/${id}`));
}
if (job.status !== 'succeeded') { console.log(JSON.stringify({id, status: job.status, error: job.error})); process.exitCode = 1; }
else {
  const {items} = await get('items'), item = items.find(i => i.id === job.itemId);
  if (!item || item.source?.generator !== 'Aholo G1-Turbo') throw Error('Succeeded job is missing its real inventory item');
  // Simulator independently re-rates and validates all geometry/runtime fields.
  const {registerItems} = await import('../../../sim/index.js'); await registerItems([item]);
  for (const asset of [item.glb, item.origin.photo, item.origin.styled]) {
    const response = await fetch(new URL(asset, base), {headers: {cookie}, signal: AbortSignal.timeout(10000)});
    if (!response.ok || !(await response.arrayBuffer()).byteLength) throw Error('Inventory asset unavailable');
  }
  console.log(JSON.stringify({id, status: job.status, itemId: item.id, category: item.category, rating: item.rating, steps: job.steps}));
}
