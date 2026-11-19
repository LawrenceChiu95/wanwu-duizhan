import {createNetplayServer, traceWriter} from './server.mjs';

const port = Number(process.env.PORT ?? 7860);
const origin = process.env.NETPLAY_ORIGIN ?? `http://127.0.0.1:${port}`;
const app = createNetplayServer({
  origin, webRoot: process.env.NETPLAY_WEB_ROOT, upstream: process.env.SHOOT_UPSTREAM,
  storeTrace: process.env.NETPLAY_TRACE_DIR ? await traceWriter(process.env.NETPLAY_TRACE_DIR) : null
});
app.server.listen(port, process.env.NETPLAY_HOST ?? '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
