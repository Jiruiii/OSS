import { workerData, parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { collectGovernmentSources } from './government-publisher.mjs';
import { normalizeAreaCatalog, areaBoundary, createAreaResolvers } from './sources/areas.mjs';
const input = JSON.parse(await readFile(new URL('../data/boundaries/geojson/town.geojson', import.meta.url), 'utf8'));
const catalog = normalizeAreaCatalog(input);
const scope = { scope: 'taiwan', coverage: 'TW', boundary: areaBoundary(catalog), ...createAreaResolvers(catalog) };
const [result] = await collectGovernmentSources(scope, new Date(), [workerData.id]);
parentPort.postMessage(result);
