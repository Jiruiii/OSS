// Read-only network verification for the source adapters. No raw records or
// credentials are printed, and the signed public feed is never modified.
import { fetchShelterStatuses } from '../sources/shelter.mjs';
import { fetchTdxRoadEvents, DEFAULT_TDX_NATIONWIDE_ENDPOINTS } from '../sources/tdx.mjs';

const selected = process.env.DIAGNOSTIC_SOURCE || 'all';
if (!['all', 'emic', 'tdx'].includes(selected)) throw Error('Invalid diagnostic source');

function causes(error) {
  const chain = [];
  for (let item = error; item && chain.length < 5; item = item.cause)
    chain.push({ name: item.name, code: item.code ?? null, status: item.status ?? null });
  return chain;
}

if (selected === 'all' || selected === 'emic') {
try {
  const raw = await fetchShelterStatuses({
    relayEndpoint: 'https://fix-government-sources.resilientgeo-feed.pages.dev/api/emic-shelters',
    allowRelay: true,
    fetchImpl: async (url, options) => {
      try {
        const response = await fetch(url, options);
        if (url.includes('/api/emic-shelters')) console.log(JSON.stringify({
          source: 'EMIC', stage: 'relay-http', status: response.status,
          sourceHeader: response.headers.get('x-government-source'),
          edge: response.headers.get('cf-ray')?.split('-').at(-1) ?? null,
        }));
        return response;
      } catch (error) {
        if (url.includes('/api/emic-shelters')) console.log(JSON.stringify({
          source: 'EMIC', stage: 'relay-network', causes: causes(error),
        }));
        throw error;
      }
    },
  });
  console.log(JSON.stringify({ source: 'EMIC', status: 'ok', records: raw.payload.records.length,
    transport: raw.payload.transport, modified: raw.response.headers.last_modified ?? null }));
} catch (error) {
  console.log(JSON.stringify({ source: 'EMIC', status: 'unavailable', causes: causes(error) }));
  process.exitCode = 1;
}
}

if (selected === 'all' || selected === 'tdx') {
try {
  const raw = await fetchTdxRoadEvents({ scope: 'taiwan', endpoints: DEFAULT_TDX_NATIONWIDE_ENDPOINTS });
  console.log(JSON.stringify({ source: 'TDX', status: raw.payload.partial ? 'partial' : 'ok',
    endpoints: raw.payload.sources.length, successful: raw.payload.sources.filter(s => s.status === 200).length,
    errors: raw.payload.sources.filter(s => s.error_code).map(s => ({
      city: new URL(s.endpoint).pathname.split('/').at(-1), status: s.status, code: s.error_code,
    })) }));
  if (raw.payload.partial) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ source: 'TDX', status: 'unavailable', code: error.code ?? error.name }));
  process.exitCode = 1;
}
}
