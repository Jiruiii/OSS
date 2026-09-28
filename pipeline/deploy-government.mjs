#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { verifyFeed, readPreviousEvents } from './lib/government-feed.mjs';
import { readPublishedJson, comparePublishedState } from './lib/government-state.mjs';

// Construct a fresh allowlisted upload directory. Old releases, private keys,
// .env files and raw API responses can never be uploaded by this command.
const publicDir = path.resolve(process.env.GOVERNMENT_PUBLIC_DIR ?? '.government-public');
const project = process.env.CLOUDFLARE_PAGES_PROJECT;
if (!project || !/^[a-z0-9-]+$/.test(project)) throw new Error('Set CLOUDFLARE_PAGES_PROJECT');
const trust = JSON.parse(await readFile('android/app/src/main/assets/trust/trusted-keys.json', 'utf8'));
const publicKey = createPublicKey({ key: Buffer.from(trust['government-feed-2026'], 'base64'), format: 'der', type: 'spki' });
const feed = verifyFeed(JSON.parse(await readFile(path.join(publicDir, 'feed.json'), 'utf8')), publicKey);
if (Date.parse(feed.expires_at) <= Date.now()) throw new Error('Cannot deploy expired feed');
const events = await readPreviousEvents(feed, async name => JSON.parse(await readFile(path.join(publicDir, name), 'utf8')), publicKey);
await mkdir('.sim-out', { recursive: true });
const upload = await mkdtemp('.sim-out/government-upload-');
for (const [name, chunk] of events.chunks) {
  const target = path.join(upload, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(chunk));
}
for (const name of ['feed.json', '_headers', 'index.html']) await writeFile(path.join(upload, name), await readFile(path.join(publicDir, name)));
for (const name of ['_worker.js', '_routes.json']) {
  const source = name === '_worker.js' ? 'pipeline/cloudflare/emic-worker.mjs' : 'pipeline/cloudflare/emic-routes.json';
  await writeFile(path.join(upload, name), await readFile(source));
}
if (events.chunks.size + 5 > 20000) throw new Error('Pages file limit exceeded');
const files = [JSON.stringify(feed), ...[...events.chunks.values()].map(chunk => JSON.stringify(chunk))];
if (files.some(file => Buffer.byteLength(file) > 25 * 1024 * 1024)) throw new Error('Pages asset size limit exceeded');
if (process.argv.includes('--prepare-only')) console.log(`Validated public upload directory: ${upload}`);
else {
  const published = await readPublishedJson(process.env.GOVERNMENT_FEED_URL || `https://${project}.pages.dev/`, 'feed.json',
    { allowMissing: process.argv.includes('--initial') });
  if (published && comparePublishedState(feed, published, publicKey) < 0)
    throw new Error('Cannot overwrite a newer published release');
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(command, ['--yes', 'wrangler@4.142.0', 'pages', 'deploy', upload, '--project-name', project,
    '--branch', 'main'], { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
