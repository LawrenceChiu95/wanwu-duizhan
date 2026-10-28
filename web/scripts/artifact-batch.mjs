// Write one publish_artifact request body for batch <n> of a pack (see pack-artifact.mjs).
// Usage: node scripts/artifact-batch.mjs <batches.json> <n> <outJson> [base] [seen]
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [plan, n, out, base, seen] = process.argv.slice(2);
const {out: dir, batches} = JSON.parse(await readFile(plan, 'utf8'));
const files = {};
for (const f of batches[Number(n)].files) {
  const buf = await readFile(join(dir, f));
  files[f] = /\.(html|js|css|json)$/.test(f) ? {content: buf.toString('utf8')} : {content_base64: buf.toString('base64')};
}
const body = {artifact: 'wanwu-top-demo', base: base && base !== 'null' ? base : null, files, title: '万物对战 · 战斗陀螺',
  description: '可玩样机：挑两件东西装到一颗核心上，转起来互撞，谁的核心先碎谁输。锅和台灯是用照片生成的 3D 模型。', icon: 'game',
  label: `陀螺版样机（第 ${Number(n) + 1}/${batches.length} 批）`};
if (seen) body.seen = Number(seen);
await writeFile(out, JSON.stringify(body));
console.log(Object.keys(files).join(' '), (JSON.stringify(body).length / 1e6).toFixed(2), 'MB');
