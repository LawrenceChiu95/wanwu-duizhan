// A test browser keeps its cookie when a fixture restarts on a new local port.
// Real browser sessions get it on the document request before starting APIs.
import {startShootServer as start} from '../shoot/server.mjs';
const identities = new Map(), directories = new Map();
export async function browserFetch(input, options = {}) {
 const origin = new URL(input).origin, identity = directories.get(origin) ?? origin;
 const headers = new Headers(options.headers);
 if (identities.has(identity) && !headers.has('cookie')) headers.set('cookie', identities.get(identity));
 const reply = await globalThis.fetch(input, {...options, headers});
 const cookie = reply.headers.get('set-cookie');
 if (cookie) identities.set(identity, cookie.split(';')[0]);
 return reply;
}
export function rememberBrowser(url, directory) { directories.set(url, directory); }
export async function startShootServer(options) {
 const app = await start(options); rememberBrowser(app.url, app.jobs.directory);
 await browserFetch(app.url + '/api/shoot/quota');
 return app;
}
