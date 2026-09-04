#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  exportPrivateKeyPem,
  exportPublicKeyPem,
  generateEd25519KeyPair,
  readPrivateKey,
  readPublicKey,
} from './lib/crypto.mjs';
import {
  buildBundle,
} from './lib/bundle.mjs';
import {
  signEvent,
  verifyBundle,
} from './lib/contract.mjs';
import { normalizeSource } from './lib/normalize.mjs';
import {
  DEFAULT_TDX_ENDPOINT,
  collectTdxRoadEvents,
  normalizeTdxRoadEvents,
} from './sources/tdx.mjs';

const NEIHU_BOUNDARY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'sources',
  'boundaries',
  'taipei-neihu.geojson',
);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2).replaceAll('-', '_');
    if (key === 'force') {
      options[key] = true;
    } else {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${key.replaceAll('_', '-')}`);
      options[key] = value;
      index += 1;
    }
  }
  return { command, options };
}

function requireOption(options, name) {
  if (!options[name]) throw new Error(`missing --${name.replaceAll('_', '-')}`);
  return options[name];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readNeihuBoundary() {
  return readJson(NEIHU_BOUNDARY_PATH);
}

function isTdxRawSnapshot(raw) {
  return raw?.schema_version === 'raw-snapshot-v0' && raw?.source_id === 'tdx-road-events';
}

function tdxSourceVersion(raw) {
  return raw.source_version
    ?? raw.payload?.UpdateTime
    ?? raw.payload?.update_time
    ?? raw.response?.headers?.etag
    ?? raw.retrieved_at;
}

function tdxExpiresAt(events) {
  return events
    .map((event) => event.expires_at)
    .sort()
    .at(-1);
}

async function keygen(options) {
  const outDir = requireOption(options, 'out_dir');
  const keyId = options.key_id ?? 'stage2-ed25519-2026';
  await mkdir(outDir, { recursive: true });
  const privatePath = path.join(outDir, 'private-key.pem');
  const publicPath = path.join(outDir, 'public-key.pem');
  if (!options.force) {
    for (const filePath of [privatePath, publicPath]) {
      try {
        await readFile(filePath);
        throw new Error(`${filePath} already exists; use --force only when intentionally replacing it`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const { privateKey, publicKey } = generateEd25519KeyPair();
  await writeFile(privatePath, exportPrivateKeyPem(privateKey), 'utf8');
  await writeFile(publicPath, exportPublicKeyPem(publicKey), 'utf8');
  await writeJson(path.join(outDir, 'key-metadata.json'), {
    key_id: keyId,
    algorithm: 'Ed25519',
    public_key_file: 'public-key.pem',
    private_key_file: 'private-key.pem',
    warning: 'Keep private-key.pem on the server. Never ship it in the Android app or fixtures.',
  });
  console.log(JSON.stringify({ key_id: keyId, public_key: publicPath, private_key: privatePath }, null, 2));
}

async function build(options) {
  const inputPath = requireOption(options, 'input');
  const outDir = requireOption(options, 'out_dir');
  const privateKeyPath = requireOption(options, 'private_key');
  const raw = await readJson(inputPath);
  const privateKey = readPrivateKey(await readFile(privateKeyPath));
  const keyId = options.key_id ?? 'stage2-ed25519-2026';
  const namespace = options.namespace ?? 'official.tdx';
  const normalized = isTdxRawSnapshot(raw)
    ? normalizeTdxRoadEvents(raw, {
      namespace,
      signingKeyId: keyId,
      boundary: await readNeihuBoundary(),
      receivedAt: raw.retrieved_at,
    })
    : normalizeSource(raw, {
      namespace,
      signingKeyId: keyId,
      receivedAt: raw.retrieved_at,
    });
  const events = normalized.map((event) => signEvent(event, privateKey));
  const datasetVersion = Number(options.dataset_version ?? raw.dataset_version ?? 1);
  if (!Number.isInteger(datasetVersion) || datasetVersion < 1) throw new Error('dataset version must be a positive integer');
  const bundle = buildBundle(events, {
    datasetId: options.dataset_id ?? raw.dataset_id ?? raw.source_id ?? 'tdx-road-events',
    namespace: options.manifest_namespace ?? 'official',
    datasetVersion,
    source: options.source ?? raw.source ?? (isTdxRawSnapshot(raw) ? 'TDX' : 'MIXED'),
    sourceVersion: options.source_version
      ?? raw.source_version
      ?? (isTdxRawSnapshot(raw) ? tdxSourceVersion(raw) : String(datasetVersion)),
    createdAt: options.created_at ?? raw.retrieved_at,
    expiresAt: options.expires_at
      ?? raw.expires_at
      ?? (isTdxRawSnapshot(raw) ? tdxExpiresAt(events) : undefined),
    signingKeyId: keyId,
    privateKey,
    targetSizeBytes: Number(options.target_size_bytes ?? 4096),
  });
  const chunksDir = path.join(outDir, 'chunks');
  await mkdir(chunksDir, { recursive: true });
  await writeJson(path.join(outDir, 'events.json'), { schema_version: 'event-batch-v0', events });
  await writeJson(path.join(outDir, 'manifest.json'), bundle.manifest);
  await Promise.all(bundle.chunks.map((chunk) => writeJson(
    path.join(chunksDir, `${chunk.chunk_id.replaceAll(':', '_')}.json`),
    chunk,
  )));
  await writeJson(path.join(outDir, 'bundle-metadata.json'), {
    dataset_id: bundle.manifest.dataset_id,
    dataset_version: bundle.manifest.dataset_version,
    manifest_id: bundle.manifest.manifest_id,
    manifest_hash: bundle.manifest.manifest_hash,
    event_count: events.length,
    chunk_count: bundle.chunks.length,
    signing_key_id: keyId,
  });
  console.log(JSON.stringify({ out_dir: outDir, manifest: bundle.manifest.manifest_id, chunks: bundle.chunks.length }, null, 2));
}

async function collect(options) {
  const source = requireOption(options, 'source');
  if (source !== 'tdx-road-events') throw new Error(`unsupported source: ${source}`);
  const outDir = requireOption(options, 'out_dir');
  const result = await collectTdxRoadEvents({
    clientId: process.env.TDX_CLIENT_ID,
    clientSecret: process.env.TDX_CLIENT_SECRET,
    endpoint: process.env.TDX_API_ENDPOINT ?? DEFAULT_TDX_ENDPOINT,
    tokenEndpoint: process.env.TDX_TOKEN_ENDPOINT,
    retrievedAt: options.retrieved_at,
    boundary: await readNeihuBoundary(),
    namespace: options.namespace,
    signingKeyId: options.key_id,
  });
  const rawFile = path.join(outDir, 'tdx-road-events.raw.json');
  const eventsFile = path.join(outDir, 'tdx-road-events.events.json');
  await mkdir(outDir, { recursive: true });
  await writeJson(rawFile, result.rawSnapshot);
  await writeJson(eventsFile, {
    schema_version: 'event-batch-v0',
    source_id: 'tdx-road-events',
    event_count: result.events.length,
    events: result.events,
  });
  await writeJson(path.join(outDir, 'collection-metadata.json'), {
    schema_version: 'collection-metadata-v0',
    source_id: 'tdx-road-events',
    mode: 'live',
    retrieved_at: result.rawSnapshot.retrieved_at,
    raw_file: path.basename(rawFile),
    events_file: path.basename(eventsFile),
    raw_record_count: result.rawSnapshot.payload.LiveEvents?.length
      ?? result.rawSnapshot.payload.Events?.length
      ?? result.rawSnapshot.payload.events?.length
      ?? null,
    curated_event_count: result.events.length,
  });
  console.log(JSON.stringify({ out_dir: outDir, raw: rawFile, events: eventsFile, event_count: result.events.length }, null, 2));
}

async function normalizeCommand(options) {
  const source = requireOption(options, 'source');
  if (source !== 'tdx-road-events') throw new Error(`unsupported source: ${source}`);
  const inputPath = requireOption(options, 'input');
  const outPath = requireOption(options, 'out');
  const raw = await readJson(inputPath);
  const events = normalizeTdxRoadEvents(raw, {
    namespace: options.namespace,
    signingKeyId: options.key_id,
    boundary: await readNeihuBoundary(),
    receivedAt: options.received_at ?? raw.retrieved_at,
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeJson(outPath, {
    schema_version: 'event-batch-v0',
    source_id: 'tdx-road-events',
    event_count: events.length,
    events,
  });
  console.log(JSON.stringify({ out: outPath, event_count: events.length }, null, 2));
}

async function verifyBundleCommand(options) {
  const manifestPath = requireOption(options, 'manifest');
  const chunksDir = requireOption(options, 'chunks_dir');
  const publicKeyPath = requireOption(options, 'public_key');
  const manifest = await readJson(manifestPath);
  const fileNames = (await readdir(chunksDir)).filter((name) => name.endsWith('.json')).sort();
  const chunks = await Promise.all(fileNames.map((name) => readJson(path.join(chunksDir, name))));
  const publicKey = readPublicKey(await readFile(publicKeyPath));
  const result = verifyBundle(
    { manifest, chunks },
    publicKey,
    {
      trustedKeyIds: [manifest.signing_key_id],
      now: options.now ?? new Date().toISOString(),
    },
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

function printHelp() {
  console.log(`Usage:
  node pipeline/cli.mjs keygen --out-dir <dir> [--key-id <id>]
  node pipeline/cli.mjs collect --source tdx-road-events --out-dir <dir>
  node pipeline/cli.mjs normalize --source tdx-road-events --input <raw.json> --out <events.json>
  node pipeline/cli.mjs build --input <tdx.json> --out-dir <dir> --private-key <pem> [options]
  node pipeline/cli.mjs verify --manifest <manifest.json> --chunks-dir <dir> --public-key <pem> [--now <time>]

Live TDX collection reads TDX_CLIENT_ID, TDX_CLIENT_SECRET, and optional
TDX_API_ENDPOINT / TDX_TOKEN_ENDPOINT from the process environment.

Build options:
  --key-id, --namespace, --manifest-namespace, --dataset-id,
  --dataset-version, --created-at, --expires-at, --target-size-bytes
`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'keygen') return keygen(options);
  if (command === 'collect') return collect(options);
  if (command === 'normalize') return normalizeCommand(options);
  if (command === 'build') return build(options);
  if (command === 'verify') return verifyBundleCommand(options);
  printHelp();
  if (command) throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 2;
});
