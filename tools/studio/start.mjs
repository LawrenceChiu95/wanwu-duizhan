import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGateway} from './gateway.mjs';

if (!/^[a-f0-9]{64}$/.test(process.env.WANWU_TUNNEL_TOKEN ?? '')) throw Error('Missing 256-bit tunnel secret');
const publicOrigin = process.env.WANWU_PUBLIC_ORIGIN;
const port = 7860;
let netplay;
if (process.env.WANWU_STUDIO_NETPLAY === '1') {
  const {createNetplayServer, traceWriter} = await import('../netplay/server.mjs');
  netplay = createNetplayServer({
    origin: publicOrigin,
    upstream: `http://127.0.0.1:${port}`,
    storeTrace: await traceWriter('/tmp/wanwu-netplay-traces'),
  });
}
const folder = path.dirname(fileURLToPath(import.meta.url));
const frps = spawn('/usr/local/bin/frps', ['-c', path.join(folder, 'frps.toml')], {stdio: ['ignore', 'inherit', 'inherit']});
const gateway = createGateway({publicOrigin, webRoot: process.env.WANWU_WEB_ROOT || null, rooms: netplay?.server});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  netplay?.close();
  gateway.disconnect(); gateway.server.close(); gateway.server.closeAllConnections(); frps.kill();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
frps.on('error', () => { console.error('frps failed to start'); stop(); process.exitCode = 1; });
frps.on('exit', () => { if (!stopping) { console.error('frps stopped'); stop(); process.exitCode = 1; } });
try {
  await gateway.ready;
  await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(port, '0.0.0.0', resolve); });
  console.log('wanwu studio ready on 7860');
} catch { stop(); process.exitCode = 1; }
