// Install only this game's user agent. Tunnel, proxy, power and OS updates are
// owned by Naomi; this script never changes them or restarts the computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';

export function launchAgent({node, script, config, logDirectory, provider}) {
  if (![node, script, config, logDirectory].every(path.isAbsolute) || !['real', 'fake'].includes(provider)) throw Error('Absolute paths and real/fake provider required');
  const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const args = [node, script, ...(provider === 'fake' ? ['--provider', 'fake'] : []), '--config', config];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.lawrence.wanwu-backend</string>
<key>ProgramArguments</key><array>${args.map(s => `<string>${xml(s)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(path.dirname(script))}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>Nice</key><integer>20</integer><key>Umask</key><integer>63</integer>
<key>ExitTimeOut</key><integer>150</integer>
<key>StandardOutPath</key><string>${xml(path.join(logDirectory, 'stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logDirectory, 'stderr.log'))}</string>
</dict></plist>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') throw Error('macOS only');
  const {values} = parseArgs({options: {config: {type: 'string'}, provider: {type: 'string', default: 'fake'}, install: {type: 'boolean', default: false}}});
  if (!path.isAbsolute(values.config ?? '')) throw Error('Absolute --config required');
  const config = JSON.parse(await fs.readFile(values.config, 'utf8'));
  if (config.port !== 4330 || !(config.publicOrigin || config.privateOrigin) || !config.budget) throw Error('Expected public shoot config');
  process.umask(0o077);
  const logDirectory = path.join(os.homedir(), 'Library/Logs/wanwu-backend');
  await fs.mkdir(logDirectory, {recursive: true, mode: 0o700}); await fs.chmod(logDirectory, 0o700);
  const agent = path.join(os.homedir(), 'Library/LaunchAgents/com.lawrence.wanwu-backend.plist');
  const script = fileURLToPath(new URL(values.provider === 'real' ? './start-real.mjs' : './server.mjs', import.meta.url));
  const plist = launchAgent({node: process.execPath, script, config: values.config, logDirectory, provider: values.provider});
  if (!values.install) { process.stdout.write(plist); process.exit(0); }
  // Refuse to overwrite a running configuration: operator must first stop just
  // this service, letting its paid-ID drain complete, before replacing it.
  const domain = `gui/${process.getuid()}`;
  let running = false;
  try { execFileSync('/bin/launchctl', ['print', `${domain}/com.lawrence.wanwu-backend`], {stdio: 'ignore'}); running = true; } catch {}
  if (running) throw Error('Stop the existing game agent before replacing its configuration');
  await fs.mkdir(path.dirname(agent), {recursive: true});
  await fs.writeFile(agent, plist, {mode: 0o600}); await fs.chmod(agent, 0o600);
  execFileSync('/usr/bin/plutil', ['-lint', agent], {stdio: 'inherit'});
  execFileSync('/bin/launchctl', ['bootstrap', domain, agent], {stdio: 'inherit'});
  console.log('Game LaunchAgent installed; confirm health before asking Naomi to expose it');
}
