// Generate files only; the operator drains jobs and reviews before bootstrap.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {launchAgent} from '../shoot/install-mac.mjs';

const {values} = parseArgs({options: {root: {type: 'string'}, node: {type: 'string'}}});
const root = values.root;
const node = values.node ?? process.execPath;
if (!path.isAbsolute(node)) throw Error('Absolute Node path required');
if (!path.isAbsolute(root ?? '')) throw Error('Absolute live root required');
process.umask(0o077);
const agents = [
  ['com.lawrence.wanwu-backend', '4330/tools/import-item/shoot/start-real.mjs', 'config/4330.json', 'logs/4330'],
  ['com.lawrence.wanwu-modelscope-backend', '4331/tools/import-item/shoot/start-real.mjs', 'config/4331.json', 'logs/4331'],
  ['com.lawrence.wanwu-frpc', 'bin/start-frpc.mjs', 'config/frpc-private.json', 'logs/frpc'],
];
await fs.mkdir(path.join(root, 'launchagents'), {recursive: true, mode: 0o700});
for (const [label, script, config, logs] of agents) {
  const logDirectory = path.join(root, logs);
  await fs.mkdir(logDirectory, {recursive: true, mode: 0o700});
  const xml = launchAgent({node, script: path.join(root, script), config: path.join(root, config), logDirectory, provider: 'real'})
    .replace('<string>com.lawrence.wanwu-backend</string>', `<string>${label}</string>`);
  await fs.writeFile(path.join(root, 'launchagents', `${label}.plist`), xml, {mode: 0o600});
}
console.log('Three inactive LaunchAgent files prepared');
