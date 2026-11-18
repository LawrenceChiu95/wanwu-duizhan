import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);
const services = {GEMINI_API_KEY: 'wanwu-gemini-api-key', AHOLO_API_KEY: 'wanwu-aholo-api-key'};
// Values stay in memory and the child's environment: never in argv or diagnostics.
export async function keychainEnvironment({env = process.env, readSecret = async name => (await run('security', ['find-generic-password', '-s', name, '-w'], {encoding: 'utf8', maxBuffer: 65536})).stdout} = {}) {
  const childEnv = {...env}, missing = [];
  const modelScope = env.SHOOT_RECOGNITION_PRIMARY === 'modelscope' || env.SHOOT_RECOGNITION_BACKUP === 'modelscope';
  const wanted = modelScope ? {...services, MODELSCOPE_API_TOKEN: 'wanwu-modelscope-api-key'} : services;
  for (const [key, name] of Object.entries(wanted)) {
    let value;
    try { value = (await readSecret(name)).trim(); } catch { /* report only the service name */ }
    if (key === 'MODELSCOPE_API_TOKEN' && env.SHOOT_RECOGNITION_PRIMARY === 'modelscope' && (!value || /[\x00-\x20\x7f]/.test(value))) {
      childEnv.SHOOT_RECOGNITION_PRIMARY = 'gemini';
      console.error('Shoot recognition configuration:', JSON.stringify({provider: 'modelscope', error: 'recognition-auth', fallback: 'gemini', time: new Date().toISOString()}));
    } else if (!value) missing.push(name);
    else childEnv[key] = value;
  }
  if (missing.length) throw Error(`Missing keychain services: ${missing.join(', ')}`);
  return childEnv;
}
export async function startReal({args = [], env = process.env, readSecret, spawnServer = spawn, nodeVersion = process.versions.node} = {}) {
  if (Number(nodeVersion.split('.')[0]) < 24) throw Error('真后台需要 Node 24 或以上；请用 Node 24 运行 start-real.mjs。');
  const {values} = parseArgs({args, options: {config: {type: 'string'}}, strict: false});
  if (values.config) {
    let config;
    try { config = JSON.parse(await readFile(values.config, 'utf8')); }
    catch { throw Error('Unable to read the shoot backend config'); }
    if (config?.recognitionPrimary !== undefined) {
      if (config.headerIdentity !== true || config.port !== 4331 || !['gemini', 'modelscope'].includes(config.recognitionPrimary)) throw Error('Recognition primary is only configurable on the dedicated judge API');
      env = {...env, SHOOT_RECOGNITION_PRIMARY: config.recognitionPrimary};
    }
  }
  const proxy = env.WANWU_REAL_PROXY ?? 'http://127.0.0.1:7897';
  const bypass = env.WANWU_REAL_NO_PROXY ?? [env.NO_PROXY, env.no_proxy, 'api.aholo.ai'].filter(Boolean).join(',');
  // The child inherits env, not the launcher's Node flags. Override both cases:
  // Node prefers https_proxy and it may point at another application's proxy.
  const childEnv = await keychainEnvironment({env: {...env, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxy, https_proxy: proxy, NO_PROXY: bypass, no_proxy: bypass}, readSecret});
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
