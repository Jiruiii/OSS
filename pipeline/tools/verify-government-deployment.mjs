#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { verifyFeed, readPreviousEvents } from '../lib/government-feed.mjs';
const base = new URL(process.env.GOVERNMENT_FEED_URL || 'https://resilientgeo-feed.pages.dev/');
if (base.protocol !== 'https:') throw new Error('Deployment verification requires HTTPS');
const keys = JSON.parse(await readFile('android/app/src/main/assets/trust/trusted-keys.json', 'utf8'));
const publicKey = createPublicKey({ key: Buffer.from(keys['government-feed-2026'], 'base64'), format: 'der', type: 'spki' });
let count = 0;
async function get(name) {
  const response = await fetch(new URL(name, base), { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Published request failed (${response.status})`);
  const buffers = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > 8 * 1024 * 1024) throw new Error('Published response exceeds size limit');
    buffers.push(part);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
const feed = verifyFeed(await get('feed.json'), publicKey);
console.log(`Verified public feed revision ${feed.revision}; downloading indexed chunks with concurrency 4`);
const events = await readPreviousEvents(feed, async name => {
  const chunk = await get(name);
  if (++count % 250 === 0) console.log(`Downloaded ${count} chunks`);
  return chunk;
}, publicKey);
console.log(JSON.stringify({ revision: feed.revision, verified_chunks: events.chunks.size,
  sources: feed.sources.map(source => ({ id: source.id, status: source.status, events: source.event_count })) }, null, 2));
