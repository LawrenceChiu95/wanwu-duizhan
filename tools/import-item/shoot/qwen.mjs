import https from 'node:https';
// This agent deliberately ignores NODE_USE_ENV_PROXY and HTTPS_PROXY. A backup
// that shares Gemini's local proxy cannot recover when that proxy stops.
const directAgent = new https.Agent({proxyEnv: {}});
const failure = code => Object.assign(Error(code), {code});
export function qwenBackup(env) {
  const mode = env.SHOOT_RECOGNITION_BACKUP;
  if (!mode || mode === 'off') return null;
  if (mode !== 'qwen') throw Error('SHOOT_RECOGNITION_BACKUP must be off or qwen');
  const key = env.DASHSCOPE_API_KEY?.trim(), base = env.DASHSCOPE_BASE_URL;
  if (!key || /[\r\n]/.test(key)) throw Error('Qwen backup requires DASHSCOPE_API_KEY');
  // A workspace URL is mandatory: do not accidentally use an overseas region,
  // a different credential recipient, query parameters, or an HTTP redirect.
  if (typeof base !== 'string' || !/^https:\/\/[a-z0-9-]{1,63}\.cn-beijing\.maas\.aliyuncs\.com\/compatible-mode\/v1\/?$/.test(base)) throw Error('Qwen backup requires a Beijing workspace DASHSCOPE_BASE_URL');
  return {key, url: base.replace(/\/$/, '') + '/chat/completions'};
}
// Bounded native HTTPS transport; no redirect, no proxy, no raw errors logged.
export function directQwenRequest(url, {headers, body, signal}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method: 'POST', headers, signal, agent: directAgent}, res => {
      const chunks = []; let size = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 262144) { const error = failure('recognition-invalid'); reject(error); res.destroy(); req.destroy(); }
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: [Buffer.concat(chunks)]}));
    });
    req.on('error', reject); req.end(body);
  });
}
// Qwen3.5-Omni requires streaming even for text-only replies. Require a clean
// finish and [DONE], so a disconnected stream cannot masquerade as valid JSON.
export function qwenStream(body) {
  let text = '', finished = false, done = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith(':')) continue;
    if (!line.startsWith('data:') || done) throw failure('recognition-invalid');
    const value = line.slice(5).trim();
    if (value === '[DONE]') { if (!finished) throw failure('recognition-invalid'); done = true; continue; }
    const chunk = JSON.parse(value);
    if (!chunk || chunk.error || !Array.isArray(chunk.choices)) throw failure('recognition-invalid');
    if (!chunk.choices.length) { if (!finished || !chunk.usage) throw failure('recognition-invalid'); continue; }
    if (chunk.choices.length !== 1 || finished) throw failure('recognition-invalid');
    const choice = chunk.choices[0], delta = choice?.delta;
    if (choice.index !== 0 || !delta || typeof delta !== 'object' || Array.isArray(delta) || delta.tool_calls || delta.audio) throw failure('recognition-invalid');
    if (delta.role !== undefined && delta.role !== 'assistant') throw failure('recognition-invalid');
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') throw failure('recognition-invalid');
      text += delta.content; if (text.length > 65536) throw failure('recognition-invalid');
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (choice.finish_reason !== 'stop') throw failure('recognition-invalid'); finished = true;
    }
  }
  if (!done || !finished) throw failure('recognition-invalid');
  return text;
}
export function qwenText(value) {
  if (typeof value !== 'string') throw failure('recognition-invalid');
  const raw = value.trim();
  // Only a whole JSON fence is tolerated; prose and partial JSON are not fixed.
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(raw);
  return fence ? fence[1].trim() : raw;
}
