import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);
const services = {GEMINI_API_KEY: 'wanwu-gemini-api-key', AHOLO_API_KEY: 'wanwu-aholo-api-key'};
// Values stay in memory and the child's environment: never in argv or diagnostics.
export async function keychainEnvironment({env = process.env, readSecret = async name => (await run('security', ['find-generic-password', '-s', name, '-w'], {encoding: 'utf8', maxBuffer: 65536})).stdout} = {}) {
  const childEnv = {...env}, missing = [];
  for (const [key, name] of Object.entries(services)) {
    let value;
    try { value = (await readSecret(name)).trim(); } catch { /* report only the service name */ }
    if (!value) missing.push(name); else childEnv[key] = value;
  }
  if (missing.length) throw Error(`Missing keychain services: ${missing.join(', ')}`);
  return childEnv;
}
export async function startReal({args = [], env, readSecret, spawnServer = spawn} = {}) {
  const childEnv = await keychainEnvironment({env, readSecret});
  return spawnServer(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--provider', 'real', ...args], {env: childEnv, stdio: 'inherit'});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const child = await startReal({args: process.argv.slice(2)});
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Unable to start the local real provider'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
