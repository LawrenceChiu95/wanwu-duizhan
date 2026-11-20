import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createGateway} from '../studio/gateway.mjs';
import {createNetplayServer, traceWriter} from './server.mjs';

const port = Number(process.env.PORT ?? 7860);
const origin = process.env.NETPLAY_ORIGIN ?? `http://127.0.0.1:${port}`;
const tunnelEnabled = process.env.NETPLAY_SHOOT_TUNNEL === '1';
const tunnelToken = process.env.WANWU_NETPLAY_TUNNEL_TOKEN;
if (tunnelEnabled && !/^[a-f0-9]{64}$/.test(tunnelToken ?? '')) throw Error('Netplay tunnel requires a 256-bit secret');

// The game server enforces its photo allowlist before reaching this loopback
// gateway. The gateway uses the backend's existing Host and forwards to frps.
const gateway = tunnelEnabled ? createGateway({
  publicOrigin: process.env.NETPLAY_SHOOT_BACKEND_ORIGIN, apiPort: 17681, frpPort: 17680
}) : null;
const app = createNetplayServer({
  origin, webRoot: process.env.NETPLAY_WEB_ROOT,
  upstream: gateway ? 'http://127.0.0.1:17682' : process.env.SHOOT_UPSTREAM,
  upgradeTunnel: gateway?.upgradeTunnel,
  storeTrace: process.env.NETPLAY_TRACE_DIR ? await traceWriter(process.env.NETPLAY_TRACE_DIR) : null
});
let frps;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  gateway?.disconnect();
  gateway?.server.close();
  gateway?.server.closeAllConnections();
  frps?.kill();
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
try {
  if (gateway) {
    gateway.server.listen(17682, '127.0.0.1');
    await once(gateway.server, 'listening');
    const config = fileURLToPath(new URL('./frps.toml', import.meta.url));
    frps = spawn('frps', ['-c', config], {
      env: {PATH: process.env.PATH, WANWU_NETPLAY_TUNNEL_TOKEN: tunnelToken},
      stdio: ['ignore', 'inherit', 'inherit']
    });
    // Netplay can still serve built-in pieces if the photo transport fails.
    frps.on('error', () => console.error('Netplay photo tunnel failed to start'));
    frps.on('exit', () => { if (!stopping) console.error('Netplay photo tunnel stopped'); });
  }
  app.server.listen(port, process.env.NETPLAY_HOST ?? '127.0.0.1');
  await once(app.server, 'listening');
} catch (cause) {
  await stop();
  throw cause;
}
