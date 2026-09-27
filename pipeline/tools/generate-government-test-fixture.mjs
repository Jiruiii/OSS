#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { readPrivateKey } from '../lib/crypto.mjs';
import { buildGovernmentFeed } from '../lib/government-feed.mjs';
const privateKey = readPrivateKey(await readFile('.stage2-keys/government-feed/private-key.pem'));
const event = JSON.parse(await readFile('fixtures/events-batch-1.json', 'utf8')).events[0];
event.expires_at = '2099-01-01T00:00:00Z';
event.attributes.status = 'CLOSED';
const output = buildGovernmentFeed({ privateKey, publicKey: createPublicKey(privateKey),
  now: new Date('2026-09-27T00:00:00Z'), results: [{ id: 'tdx-road', status: 'ok', events: [event] }] });
const directory = 'android/app/src/test/resources/government';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/feed.json`, JSON.stringify(output.feed));
await writeFile(`${directory}/chunk.json`, JSON.stringify([...output.files.values()][0]));
console.log('Signed synthetic JVM fixture generated (never packaged in production assets).');
