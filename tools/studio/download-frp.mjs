import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';

// Pinned official release and its published SHA-256; no runtime download.
const response = await fetch('https://github.com/fatedier/frp/releases/download/v0.72.0/frp_0.72.0_linux_amd64.tar.gz', {signal: AbortSignal.timeout(90000)});
if (!response.ok) throw Error('frp download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== 'daf719b32ca2778770bb92955e231a07414d754378b9af328aa2642862479804') throw Error('frp checksum mismatch');
await fs.writeFile('/tmp/frp.tar.gz', bytes);
