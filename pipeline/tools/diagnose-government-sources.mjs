// Read-only network verification for the source adapters. No raw records or
// credentials are printed, and the signed public feed is never modified.
import { fetchShelterStatuses } from '../sources/shelter.mjs';
import { fetchTdxRoadEvents, DEFAULT_TDX_NATIONWIDE_ENDPOINTS } from '../sources/tdx.mjs';

try {
  const raw = await fetchShelterStatuses({
    relayEndpoint: 'https://fix-government-sources.resilientgeo-feed.pages.dev/api/emic-shelters',
  });
  console.log(JSON.stringify({ source: 'EMIC', status: 'ok', records: raw.payload.records.length,
    transport: raw.payload.transport, modified: raw.response.headers.last_modified ?? null }));
} catch (error) {
  console.log(JSON.stringify({ source: 'EMIC', status: 'unavailable', code: error.code ?? error.name }));
  process.exitCode = 1;
}

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
