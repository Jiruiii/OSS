import { lookup, resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { fetchShelterStatuses, DEFAULT_SHELTER_STATUS_ENDPOINT } from '../sources/shelter.mjs';
import { fetchTdxRoadEvents, DEFAULT_TDX_NATIONWIDE_ENDPOINTS } from '../sources/tdx.mjs';

function causes(error) {
  const output = [];
  for (let e = error; e && output.length < 5; e = e.cause) output.push({ name: e.name, code: e.code, status: e.status });
  return output;
}
const host = new URL(DEFAULT_SHELTER_STATUS_ENDPOINT).hostname;
for (const [name, get] of [['system', () => lookup(host, { all: true })], ['resolver', () => resolve4(host)]]) {
  try { console.log(JSON.stringify({ dns: name, answers: await get() })); }
  catch (error) { console.log(JSON.stringify({ dns: name, causes: causes(error) })); }
}
const dns = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
  headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(10000),
}).then(r => r.json());
const addresses = [...new Set([...(dns.Answer ?? []).filter(a => a.type === 1).map(a => a.data), ...await resolve4(host)])];
console.log(JSON.stringify({ dns: 'https-public', addresses }));
for (const address of [undefined, ...addresses]) {
  const started = Date.now();
  try {
    const fetchImpl = address ? (url, options) => new Promise((resolve, reject) => {
      const req = request(url, { headers: options.headers, signal: options.signal, family: 4, autoSelectFamily: false,
        lookup: (_hostname, _options, callback) => callback(null, address, 4) }, response => {
        const parts = [];
        response.on('data', part => parts.push(part));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers),
          text: async () => Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject); req.end();
    }) : globalThis.fetch;
    const snapshot = await fetchShelterStatuses({ fetchImpl, timeoutMs: 12000 });
    console.log(JSON.stringify({ source: 'EMIC', route: address || 'system', elapsed: Date.now() - started,
      records: snapshot.payload.records.length }));
  } catch (error) { console.log(JSON.stringify({ source: 'EMIC', route: address || 'system', elapsed: Date.now() - started, causes: causes(error) })); }
}
const raw = await fetchTdxRoadEvents({ scope: 'taiwan', endpoints: DEFAULT_TDX_NATIONWIDE_ENDPOINTS.slice(0, 6),
  fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (response.status === 429) console.log(JSON.stringify({ source: 'TDX', http: 429,
      rateHeaders: Object.fromEntries([...response.headers].filter(([name]) => /retry-after|ratelimit|rate-limit/i.test(name))) }));
    return response;
  }, timeoutMs: 15000 });
console.log(JSON.stringify({ source: 'TDX', endpoints: raw.payload.sources.map(s => ({
  city: new URL(s.endpoint).pathname.split('/').at(-1), status: s.status, error: s.error_code })) }));
