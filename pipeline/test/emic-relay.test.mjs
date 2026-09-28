import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relayEmic, EMIC_URL } from '../cloudflare/emic-worker.mjs';
import bridge from '../cloudflare/emic-bridge.mjs';
import { fetchShelterStatuses, DEFAULT_SHELTER_STATUS_ENDPOINT } from '../sources/shelter.mjs';

const XML = '<root><shelter><shelterCode>S-1</shelterCode><county>Taipei</county><town>Neihu</town><lat>25.08</lat><lon>121.58</lon><openstatus>開設</openstatus></shelter></root>';

test('Pages relay serves only live official XML with source and modification headers', async () => {
  const upstream = [];
  const result = await relayEmic(new Request('https://relay.test/api/emic-shelters'), async (url, options) => {
    upstream.push({ url, options });
    return new Response(XML, { headers: { 'Content-Type': 'text/xml',
      'Last-Modified': 'Mon, 28 Sep 2026 08:00:01 GMT' } });
  });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), XML);
  assert.equal(result.headers.get('x-government-source'), EMIC_URL);
  assert.equal(result.headers.get('last-modified'), 'Mon, 28 Sep 2026 08:00:01 GMT');
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].url, EMIC_URL);
  assert.equal(upstream[0].options.redirect, 'manual');
  assert.equal((await relayEmic(new Request('https://relay.test/api/emic-shelters', {
    method: 'POST',
  }))).status, 405);
  assert.equal((await bridge.fetch(new Request('https://relay.test/elsewhere'))).status, 404);
});

test('EMIC collector uses controlled relay only after official feed is unreachable', async () => {
  const calls = [];
  const raw = await fetchShelterStatuses({
    retrievedAt: '2026-09-28T08:05:00Z', allowRelay: true,
    relayEndpoint: 'https://resilientgeo-emic-bridge.example.workers.dev/api/emic-shelters',
    fetchImpl: async url => {
      calls.push(url);
      if (url === DEFAULT_SHELTER_STATUS_ENDPOINT) throw new Error('unreachable');
      return new Response(XML, { headers: { 'X-Government-Source': DEFAULT_SHELTER_STATUS_ENDPOINT,
        'Last-Modified': 'Mon, 28 Sep 2026 08:00:01 GMT' } });
    },
  });
  assert.deepEqual(calls.slice(0, 3), Array(3).fill(DEFAULT_SHELTER_STATUS_ENDPOINT));
  assert.equal(calls.length, 4);
  assert.equal(raw.payload.transport, 'cloudflare-relay');
  assert.equal(raw.request.url, DEFAULT_SHELTER_STATUS_ENDPOINT);
  assert.equal(raw.response.headers.last_modified, 'Mon, 28 Sep 2026 08:00:01 GMT');
  assert.equal(raw.payload.records.length, 1);
});
