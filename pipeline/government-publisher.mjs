#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readPrivateKey } from './lib/crypto.mjs';
import { buildGovernmentFeed, readPreviousEvents, verifyFeed } from './lib/government-feed.mjs';
import { readPublishedJson, comparePublishedState } from './lib/government-state.mjs';
import { fetchNcdrHazards, normalizeNcdrFeed } from './sources/ncdr.mjs';
import { fetchCwaEarthquakes, normalizeCwaEarthquakes, fetchCwaWarnings, normalizeCwaWarnings,
  fetchCwaTyphoonWarnings, normalizeCwaTyphoonWarnings } from './sources/cwa.mjs';
import { collectTdxRoadEvents, DEFAULT_TDX_NATIONWIDE_ENDPOINTS } from './sources/tdx.mjs';
import { fetchShelterStatuses, normalizeShelterStatuses } from './sources/shelter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async name => JSON.parse(await readFile(name, 'utf8'));
export async function collectGovernmentSources(scope, now = new Date(), sourceIds) {
  const options = { ...scope, receivedAt: now.toISOString(), retrievedAt: now.toISOString() };
  const adapters = [
    ['ncdr', async () => { const raw = await fetchNcdrHazards({ retrievedAt: options.retrievedAt,
      authMode: process.env.NCDR_AUTH_MODE || 'query' });
      return { rawSnapshot: raw, ...normalizeNcdrFeed(raw, options) }; }],
    ...[['cwa-earthquake', fetchCwaEarthquakes, normalizeCwaEarthquakes],
      ['cwa-warning', fetchCwaWarnings, normalizeCwaWarnings],
      ['cwa-typhoon', fetchCwaTyphoonWarnings, normalizeCwaTyphoonWarnings]]
      .map(([id, fetcher, normalizer]) => [id, async () => {
        const raw = await fetcher({ apiKey: process.env.CWA_API_KEY, retrievedAt: options.retrievedAt });
        return { rawSnapshot: raw, events: normalizer(raw, options) }; }]),
    ['tdx-road', () => collectTdxRoadEvents({ ...options,
      endpoints: process.env.TDX_API_ENDPOINTS?.split(',').filter(Boolean) ?? DEFAULT_TDX_NATIONWIDE_ENDPOINTS })],
    ['shelter-status', async () => { const raw = await fetchShelterStatuses({ retrievedAt: options.retrievedAt });
      const events = normalizeShelterStatuses(raw, options);
      return { rawSnapshot: raw, events, unresolvedCount: events.unresolved_count }; }],
  ];
  return Promise.all(adapters.filter(([id]) => !sourceIds || sourceIds.includes(id)).map(async ([id, collect]) => {
    try {
      const result = await collect();
      const events = result.events.filter(event => event.attributes?.map_visible !== false);
      for (const event of events) delete event.attributes.source_record;
      const status = result.rawSnapshot.payload?.partial || result.unresolvedCount ? 'partial' :
          result.rawSnapshot.payload?.stale ? 'stale' : 'ok';
      console.log(`Source ${id}: ${status}; curated events=${events.length}`);
      return { id, events, retrievedAt: result.rawSnapshot.retrieved_at,
        cancelledEventIds: result.cancelledEventIds, unresolvedCount: result.unresolvedCount,
        status: result.rawSnapshot.payload?.partial || result.unresolvedCount ? 'partial' :
          result.rawSnapshot.payload?.stale ? 'stale' : 'ok' };
    } catch (error) {
      console.log(`Source ${id}: unavailable (${error.code ?? error.name})`);
      return { id, status: error.status === 401 || error.status === 403 || /AUTH|CREDENTIAL/.test(error.code ?? '')
        ? 'blocked_by_auth' : 'unavailable' };
    }
  }));
}

// Keep a large or malformed government response from blocking every other
// source, the signing step and the update schedule. Workers are disposable;
// the signed previous release remains the durable state.
export async function collectWithDeadline(timeoutMs = 180000) {
  return Promise.all(['ncdr', 'cwa-earthquake', 'cwa-warning', 'cwa-typhoon', 'tdx-road', 'shelter-status'].map(id =>
    new Promise(resolve => {
      const worker = new Worker(new URL('./government-collector-worker.mjs', import.meta.url), {
        workerData: { id }, resourceLimits: { maxOldGenerationSizeMb: 384 },
      });
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(() => {
        console.log(`Source ${id}: unavailable (collection deadline)`);
        finish({ id, status: 'unavailable' });
      }, timeoutMs);
      worker.once('message', finish);
      worker.once('error', () => finish({ id, status: 'unavailable' }));
      worker.once('exit', () => finish({ id, status: 'unavailable' }));
    })));
}

export async function publishGovernment({ outDir, privateKeyPath, bootstrapUrl, allowInitial = false }) {
  const privateKey = readPrivateKey(await readFile(privateKeyPath));
  const publicKey = createPublicKey(privateKey);
  const trusted = await json(path.join(root, 'android/app/src/main/assets/trust/trusted-keys.json'));
  if (trusted['government-feed-2026'] !== publicKey.export({ format: 'der', type: 'spki' }).toString('base64'))
    throw new Error('Signing key does not match the key trusted by the app');
  let previous;
  let readChunk;
  if (await access(path.join(outDir, 'feed.json')).then(() => true, () => false)) {
    previous = await json(path.join(outDir, 'feed.json'));
    readChunk = name => json(path.join(outDir, name));
  }
  if (bootstrapUrl) {
    const published = verifyFeed(await readPublishedJson(bootstrapUrl, 'feed.json'), publicKey);
    if (!previous || comparePublishedState(previous, published, publicKey) < 0) {
      previous = published;
      readChunk = name => readPublishedJson(bootstrapUrl, name);
    }
  }
  if (!previous && !allowInitial) throw new Error('No prior signed state. Use --initial only for the first deployment.');
  if (previous) verifyFeed(previous, publicKey);
  const previousEvents = previous ? await readPreviousEvents(previous, readChunk, publicKey) : {};
  const results = await collectWithDeadline();
  const output = buildGovernmentFeed({ previous, previousEvents, results, privateKey, publicKey });
  const chunks = [...output.files.values()].map(chunk => JSON.stringify(chunk));
  if (chunks.length > 4096 || chunks.some(chunk => Buffer.byteLength(chunk) > 256 * 1024) ||
      chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0) > 24 * 1024 * 1024 ||
      Buffer.byteLength(JSON.stringify(output.feed)) > 8 * 1024 * 1024) {
    throw new Error('Government release exceeds mobile transfer limits');
  }
  for (const [name, value] of output.files) {
    const target = path.join(outDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value));
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, '_headers'), '/feed.json\n  Cache-Control: no-store\n/*\n  X-Content-Type-Options: nosniff\n');
  await writeFile(path.join(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Resilient Geo Mesh</title><p>Signed government feed: <a href="feed.json">feed.json</a></p>');
  await writeFile(path.join(outDir, 'feed.json.tmp'), JSON.stringify(output.feed));
  await rename(path.join(outDir, 'feed.json.tmp'), path.join(outDir, 'feed.json'));
  return { revision: output.feed.revision, sources: output.feed.sources, chunks: output.files.size };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.env.GOVERNMENT_PUBLIC_DIR ?? '.government-public');
  const privateKeyPath = process.env.PIPELINE_SIGNING_PRIVATE_KEY || '.stage2-keys/government-feed/private-key.pem';
  publishGovernment({ outDir, privateKeyPath, bootstrapUrl: process.env.GOVERNMENT_FEED_URL,
    allowInitial: process.argv.includes('--initial') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('Government publication failed; prior release preserved. Check configuration and signed state.'); process.exitCode = 1; });
}
