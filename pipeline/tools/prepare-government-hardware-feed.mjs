#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPublicKey } from 'node:crypto';
import { readPrivateKey } from '../lib/crypto.mjs';
import { buildGovernmentFeed, readPreviousEvents } from '../lib/government-feed.mjs';
const privateKey = readPrivateKey(await readFile('.stage2-keys/government-feed/private-key.pem'));
const publicKey = createPublicKey(privateKey);
const feed = JSON.parse(await readFile('.government-public/feed.json', 'utf8'));
const events = await readPreviousEvents(feed, async name => JSON.parse(await readFile(path.join('.government-public', name), 'utf8')), publicKey);
const now = new Date();
const id = Object.keys(events).find(id => events[id].some(event => Date.parse(event.expires_at) > now.getTime() + 600000));
if (!id) throw new Error('No live real government event with enough remaining TTL; do not silently use a fixture');
const event = events[id].find(event => Date.parse(event.expires_at) > now.getTime() + 600000);
const output = buildGovernmentFeed({ privateKey, publicKey, now, results: [{ id, status: 'ok', events: [event] }] });
const directory = '.sim-out/government-hardware-feed';
await mkdir(directory, { recursive: true });
for (const [name, chunk] of output.files) {
  const target = path.join(directory, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(chunk));
}
await writeFile(`${directory}/feed.json`, JSON.stringify(output.feed));
console.log(JSON.stringify({ source: id, event_id: event.event_id, event_type: event.event_type, expires_at: event.expires_at }));
