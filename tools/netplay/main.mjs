import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createGateway} from '../studio/gateway.mjs';
import {createNetplayServer, traceWriter} from './server.mjs';

const port = Number(process.env.PORT ?? 7860);
const origin = process.env.NETPLAY_ORIGIN ?? `http://127.0.0.1:${port}`;
const tunnelEnabled = process.env.NETPLAY_SHOOT_TUNNEL === '1';
const tunnelToken = process.env.WANWU_NETPLAY_TUNNEL_TOKEN;
const gatewayPort = 17682;
const minRestartDelay = 1000;
const maxRestartDelay = 60_000;

// The game server enforces its photo allowlist before reaching this loopback
// gateway. The gateway uses the backend's existing Host and forwards to frps.
async function openPhotoGateway() {
  if (!/^[a-f0-9]{64}$/.test(tunnelToken ?? '')) {
    console.error('Netplay photo tunnel disabled: a 256-bit secret is required');
    return null;
  }
  let gateway;
  try {
    gateway = createGateway({
      publicOrigin: process.env.NETPLAY_SHOOT_BACKEND_ORIGIN, apiPort: 17681, frpPort: 17680
    });
  } catch {
    console.error('Netplay photo tunnel disabled: an exact HTTPS backend origin is required');
    return null;
  }
  try {
    gateway.server.listen(gatewayPort, '127.0.0.1');
    await once(gateway.server, 'listening');
    return gateway;
  } catch {
    console.error('Netplay photo tunnel disabled: could not listen on the loopback gateway port');
    return null;
  }
}

let gateway;
let app;
let frps;
let frpsRestart;
let restartDelay = minRestartDelay;
let stopping = false;
function startFrps() {
  const config = fileURLToPath(new URL('./frps.toml', import.meta.url));
  const startedAt = performance.now();
  frps = spawn('frps', ['-c', config], {
    env: {PATH: process.env.PATH, WANWU_NETPLAY_TUNNEL_TOKEN: tunnelToken},
    stdio: ['ignore', 'inherit', 'inherit']
  });
  frps.once('error', () => console.error('Netplay photo tunnel failed to start'));
  // close fires once after either a spawn failure or process exit.
  frps.once('close', () => {
    frps = null;
    if (stopping) return;
    if (performance.now() - startedAt >= maxRestartDelay) restartDelay = minRestartDelay;
    console.warn(`Netplay photo tunnel stopped; retrying in ${restartDelay} ms`);
    frpsRestart = setTimeout(startFrps, restartDelay).unref();
    restartDelay = Math.min(restartDelay * 2, maxRestartDelay);
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(frpsRestart);
  gateway?.disconnect();
  gateway?.server.close();
  gateway?.server.closeAllConnections();
  frps?.kill();
  await app?.close();
}

try {
  const storeTrace = process.env.NETPLAY_TRACE_DIR ? await traceWriter(process.env.NETPLAY_TRACE_DIR) : null;
  let upstream = process.env.SHOOT_UPSTREAM;
  if (tunnelEnabled) {
    gateway = await openPhotoGateway();
    upstream = gateway ? `http://127.0.0.1:${gatewayPort}` : undefined;
  }
  app = createNetplayServer({
    origin, webRoot: process.env.NETPLAY_WEB_ROOT, upstream,
    upgradeTunnel: gateway?.upgradeTunnel, storeTrace
  });
  app.server.listen(port, process.env.NETPLAY_HOST ?? '127.0.0.1');
  await once(app.server, 'listening');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  if (gateway) startFrps();
} catch (cause) {
  await stop();
  throw cause;
}
