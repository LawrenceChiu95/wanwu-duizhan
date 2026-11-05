import net from 'node:net';

// A local TCP probe catches a stopped proxy without making a paid vision call.
// It cannot establish whether the proxy's upstream or the model is healthy.
export async function recognitionProxyHealth(env) {
  const proxy = env.https_proxy || env.HTTPS_PROXY;
  if (!proxy) return {required: false, reachable: null, check: 'direct-unverified'};
  if (env.NODE_USE_ENV_PROXY !== '1') return {required: true, reachable: false, check: 'proxy-not-enabled'};
  let url;
  try { url = new URL(proxy); if (!['http:', 'https:'].includes(url.protocol)) throw Error(); }
  catch { return {required: true, reachable: false, check: 'invalid-proxy'}; }
  const reachable = await new Promise(resolve => {
    const socket = net.createConnection({host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80))});
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
  return {required: true, reachable, check: 'tcp-only'};
}
