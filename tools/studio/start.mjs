import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGateway} from './gateway.mjs';

if (!/^[a-f0-9]{64}$/.test(process.env.WANWU_TUNNEL_TOKEN ?? '')) throw Error('Missing 256-bit tunnel secret');
const folder = path.dirname(fileURLToPath(import.meta.url));
const frps = spawn('/usr/local/bin/frps', ['-c', path.join(folder, 'frps.toml')], {stdio: ['ignore', 'inherit', 'inherit']});
const gateway = createGateway({publicOrigin: process.env.WANWU_PUBLIC_ORIGIN, webRoot: process.env.WANWU_WEB_ROOT || null});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true; gateway.disconnect(); gateway.server.close(); gateway.server.closeAllConnections(); frps.kill();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
frps.on('error', () => { console.error('frps failed to start'); stop(); process.exitCode = 1; });
frps.on('exit', () => { if (!stopping) { console.error('frps stopped'); stop(); process.exitCode = 1; } });
try {
  await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(7860, '0.0.0.0', resolve); });
  console.log('wanwu studio ready on 7860');
} catch { stop(); process.exitCode = 1; }
