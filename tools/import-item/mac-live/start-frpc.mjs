import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

// The private config is local only. Secrets stay out of argv and diagnostics.
try {
  const {values} = parseArgs({options: {config: {type: 'string'}}});
  if (!path.isAbsolute(values.config ?? '')) throw Error();
  const stat = await fs.stat(values.config);
  if (stat.mode & 0o077) throw Error();
  const config = JSON.parse(await fs.readFile(values.config, 'utf8'));
  if (![config.binary, config.template].every(value => typeof value === 'string' && path.isAbsolute(value))) throw Error();
  const env = {...process.env};
  // The existing frpc connects directly; launchd can inherit desktop proxy vars.
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  for (const key of ['WANWU_PUBLIC_HOST', 'WANWU_BACKEND_PORT', 'WANWU_TUNNEL_TOKEN']) {
    if (typeof config.environment?.[key] !== 'string' || !config.environment[key]) throw Error();
    env[key] = config.environment[key];
  }
  const child = spawn(config.binary, ['-c', config.template], {env, stdio: 'inherit'});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Unable to start the game tunnel'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch {
  console.error('Unable to read the private game tunnel configuration');
  process.exitCode = 1;
}
