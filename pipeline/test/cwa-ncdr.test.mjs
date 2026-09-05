import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CwaCredentialError,
  CwaSourceError,
  fetchCwaEarthquakes,
  fetchCwaWarnings,
  normalizeCwaEarthquakes,
  normalizeCwaWarnings,
} from '../sources/cwa.mjs';
import {
  NcdrCredentialError,
  NcdrSourceError,
  fetchNcdrHazards,
  normalizeNcdrHazards,
} from '../sources/ncdr.mjs';
import { makeRawSnapshot } from '../lib/source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OFFICIAL_NEIHU_BOUNDARY = JSON.parse(readFileSync(
  path.join(ROOT, 'pipeline/sources/boundaries/taipei-neihu.geojson'),
  'utf8',
));

const CWA_EARTHQUAKE_ENDPOINT = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001';
const CWA_WARNING_ENDPOINT = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-001';
const NCDR_ENDPOINT = 'https://alerts.ncdr.nat.gov.tw/api/datastore';
const RETRIEVED_AT = '2026-09-04T04:00:00Z';

function response({ status = 200, payload = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    async json() {
      return payload;
    },
  };
}

function cwaEarthquakePayload() {
  return {
    success: true,
    result: {
      resource_id: 'E-A0015-001',
      records: [
        {
          EarthquakeNo: '115001',
          IssueTime: '2026-09-04T12:05:00+08:00',
          EndTime: '2026-09-05T12:05:00+08:00',
          OriginTime: '2026-09-04T12:01:00+08:00',
          EpicenterLatitude: '25.1000',
          EpicenterLongitude: '121.5800',
          MagnitudeValue: '4.2',
          CountyName: '臺北市',
          AreaDesc: '臺北市地區',
          StationID: 'NEIHU-001',
          StationName: '內湖測站',
          StationLatitude: '25.0800',
          StationLongitude: '121.5800',
          SeismicIntensity: '3級',
          unit: 'gal',
        },
        {
          EarthquakeNo: '115002',
          IssueTime: '2026-09-04T13:05:00+08:00',
          EndTime: '2026-09-05T13:05:00+08:00',
          OriginTime: '2026-09-04T13:01:00+08:00',
          EpicenterLatitude: '25.0000',
          EpicenterLongitude: '121.5000',
          MagnitudeValue: '3.1',
          CountyName: '新北市',
          AreaDesc: '新北市地區',
          StationID: 'OUTSIDE-001',
          StationLatitude: '25.0000',
          StationLongitude: '121.5000',
          SeismicIntensity: '1級',
          unit: 'gal',
        },
      ],
    },
  };
}

function cwaWarningPayload() {
  return {
    success: true,
    result: {
      resource_id: 'W-C0033-001',
      records: [
        {
          identifier: 'CWA-WARNING-NEIHU-001',
          IssueTime: '2026-09-04T03:00:00+08:00',
          EndTime: '2026-09-04T09:00:00+08:00',
          CountyName: '臺北市',
          AreaDesc: '臺北市',
          WarningType: '豪雨特報',
          Severity: 'Severe',
          Description: '臺北市有局部大雨發生的機率。',
        },
        {
          identifier: 'CWA-WARNING-OUTSIDE-001',
          IssueTime: '2026-09-04T03:00:00+08:00',
          EndTime: '2026-09-04T09:00:00+08:00',
          CountyName: '花蓮縣',
          AreaDesc: '花蓮縣',
          WarningType: '豪雨特報',
          Severity: 'Severe',
        },
      ],
    },
  };
}

function cwaEarthquakeApiPayload() {
  const payload = cwaEarthquakePayload();
  return {
    success: true,
    result: {
      resource_id: payload.result.resource_id,
      fields: [],
    },
    records: {
      datasetDescription: 'CWA earthquake reports',
      Earthquake: payload.result.records,
    },
  };
}

function cwaWarningApiPayload() {
  return {
    success: true,
    result: {
      resource_id: 'W-C0033-001',
      fields: [],
    },
    records: {
      location: [
        {
          locationName: '臺北市',
          geocode: 63000,
          hazardConditions: {
            hazards: [
              {
                info: {
                  language: 'zh-TW',
                  phenomena: '豪雨',
                  significance: '特報',
                },
                validTime: {
                  startTime: '2026-09-04 03:00:00',
                  endTime: '2026-09-04 09:00:00',
                },
              },
            ],
          },
        },
        {
          locationName: '花蓮縣',
          geocode: 10015,
          hazardConditions: {
            hazards: [],
          },
        },
      ],
    },
  };
}

function ncdrPayload() {
  return {
    data: [
      {
        CAPID: 'NCDR-NEIHU-FLOOD-001',
        event: '淹水警戒',
        sent: '2026-09-04T02:00:00+08:00',
        effective: '2026-09-04T02:00:00+08:00',
        expires: '2026-09-04T03:00:00+08:00',
        polygon: '25.0700,121.5700 25.0700,121.5900 25.0900,121.5900 25.0900,121.5700 25.0700,121.5700',
        areaDesc: '臺北市內湖區',
        severity: 'Severe',
        description: '內湖區淹水示警測試資料',
      },
      {
        CAPID: 'NCDR-OUTSIDE-001',
        event: '土石流警戒',
        sent: '2026-09-04T02:00:00+08:00',
        effective: '2026-09-04T02:00:00+08:00',
        expires: '2026-09-04T03:00:00+08:00',
        geometry: { type: 'Point', coordinates: [121.50, 25.00] },
        areaDesc: '新北市',
      },
      {
        CAPID: 'NCDR-EXPIRED-001',
        event: '雨量警戒',
        sent: '2026-09-03T02:00:00+08:00',
        effective: '2026-09-03T02:00:00+08:00',
        expires: '2026-09-03T03:00:00+08:00',
        geometry: { type: 'Point', coordinates: [121.58, 25.08] },
        areaDesc: '臺北市內湖區',
      },
    ],
  };
}

function rawSnapshot(sourceId, endpoint, payload) {
  return makeRawSnapshot({
    sourceId,
    request: { method: 'GET', url: endpoint, query: { format: 'JSON' } },
    responseStatus: 200,
    responseHeaders: { ETag: `"${sourceId}-snapshot-1"`, 'Content-Type': 'application/json' },
    retrievedAt: RETRIEVED_AT,
    payload,
  });
}

test('rejects CWA collection when the API key is missing', async () => {
  await assert.rejects(
    fetchCwaEarthquakes({ apiKey: '', fetchImpl: async () => response() }),
    (error) => error instanceof CwaCredentialError
      && /CWA_API_KEY/u.test(error.message),
  );
});

test('fetches CWA earthquake data and keeps the API key out of Raw', async () => {
  const calls = [];
  const apiKey = 'cwa-api-key-for-test';
  const snapshot = await fetchCwaEarthquakes({
    apiKey,
    endpoint: CWA_EARTHQUAKE_ENDPOINT,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        payload: cwaEarthquakePayload(),
        headers: { ETag: '"cwa-eq-1"' },
      });
    },
    retrievedAt: RETRIEVED_AT,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /format=JSON/u);
  assert.match(calls[0].url, /Authorization=cwa-api-key-for-test/u);
  assert.equal(snapshot.source_id, 'cwa-earthquake');
  assert.equal(snapshot.response.headers.etag, '"cwa-eq-1"');
  assert.equal(snapshot.payload.result.records.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /cwa-api-key-for-test/u);
});

test('normalizes CWA earthquakes, keeps Neihu observations, and excludes outside records', () => {
  const raw = rawSnapshot('cwa-earthquake', CWA_EARTHQUAKE_ENDPOINT, cwaEarthquakePayload());
  const events = normalizeCwaEarthquakes(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY });

  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'cwa:earthquake:115001:neihu-001');
  assert.equal(events[0].event_type, 'EARTHQUAKE_INTENSITY');
  assert.deepEqual(events[0].geometry, { type: 'Point', coordinates: [121.58, 25.08] });
  assert.equal(events[0].issued_at, '2026-09-04T04:01:00.000Z');
  assert.equal(events[0].expires_at, '2026-09-05T04:05:00.000Z');
  assert.equal(events[0].attributes.area_id, 'neihu');
  assert.equal(events[0].attributes.theme, 'earthquake');
  assert.equal(events[0].attributes.alert_id, '115001');
  assert.equal(events[0].attributes.affected_area, '臺北市地區');
  assert.equal(events[0].attributes.source_description, '臺北市地區');
  assert.equal(events[0].attributes.original_unit, 'gal');
  assert.equal(events[0].attributes.source_record.StationID, 'NEIHU-001');
});

test('normalizes the CWA earthquake API shape with records grouped under Earthquake', () => {
  const raw = rawSnapshot('cwa-earthquake', CWA_EARTHQUAKE_ENDPOINT, cwaEarthquakeApiPayload());
  const events = normalizeCwaEarthquakes(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY });

  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'cwa:earthquake:115001:neihu-001');
});

test('normalizes CWA city-level warnings as Neihu-applicable events with explicit city coverage', () => {
  const raw = rawSnapshot('cwa-weather-warning', CWA_WARNING_ENDPOINT, cwaWarningPayload());
  const events = normalizeCwaWarnings(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY });

  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'cwa:warning:cwa-warning-neihu-001');
  assert.equal(events[0].event_type, 'WEATHER_WARNING');
  assert.equal(events[0].attributes.coverage_level, 'city');
  assert.equal(events[0].attributes.area_id, 'neihu');
  assert.equal(events[0].attributes.theme, 'weather');
  assert.equal(events[0].attributes.alert_id, 'CWA-WARNING-NEIHU-001');
  assert.equal(events[0].attributes.affected_area, '臺北市');
  assert.equal(events[0].attributes.source_description, '臺北市有局部大雨發生的機率。');
  assert.equal(events[0].expires_at, '2026-09-04T01:00:00.000Z');
  assert.deepEqual(events[0].geometry, OFFICIAL_NEIHU_BOUNDARY.features[0].geometry);
});

test('normalizes the CWA warning API shape with records grouped under location', () => {
  const raw = rawSnapshot('cwa-weather-warning', CWA_WARNING_ENDPOINT, cwaWarningApiPayload());
  const events = normalizeCwaWarnings(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY });

  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'cwa:warning:w-c0033-001:63000:2026-09-04-03:00:00:0');
  assert.equal(events[0].attributes.affected_area, '臺北市');
  assert.equal(events[0].attributes.source_description, '豪雨');
  assert.equal(events[0].issued_at, '2026-09-03T19:00:00.000Z');
  assert.equal(events[0].expires_at, '2026-09-04T01:00:00.000Z');
  assert.equal(events[0].attributes.source_record.hazard.info.phenomena, '豪雨');
});

test('rejects a CWA warning with malformed time or an invalid source id', () => {
  const malformed = rawSnapshot('cwa-weather-warning', CWA_WARNING_ENDPOINT, {
    result: { records: [{ ...cwaWarningPayload().result.records[0], EndTime: 'not-a-time' }] },
  });
  assert.throws(
    () => normalizeCwaWarnings(malformed, { boundary: OFFICIAL_NEIHU_BOUNDARY }),
    (error) => error instanceof CwaSourceError && /TIME/u.test(error.code),
  );

  const invalidSource = rawSnapshot('wrong-source', CWA_WARNING_ENDPOINT, cwaWarningPayload());
  assert.throws(
    () => normalizeCwaWarnings(invalidSource, { boundary: OFFICIAL_NEIHU_BOUNDARY }),
    (error) => error instanceof CwaSourceError && /SOURCE_ID/u.test(error.code),
  );
});

test('rejects CWA records without stable identity or usable geometry', () => {
  const raw = rawSnapshot('cwa-earthquake', CWA_EARTHQUAKE_ENDPOINT, {
    result: {
      records: [{
        IssueTime: '2026-09-04T12:05:00+08:00',
        EndTime: '2026-09-05T12:05:00+08:00',
        CountyName: '臺北市',
      }],
    },
  });
  assert.throws(
    () => normalizeCwaEarthquakes(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY }),
    (error) => error instanceof CwaSourceError && /ID/u.test(error.code),
  );
});

test('rejects NCDR collection when the token is missing', async () => {
  await assert.rejects(
    fetchNcdrHazards({ credentials: {}, fetchImpl: async () => response() }),
    (error) => error instanceof NcdrCredentialError
      && /NCDR_API_KEY/u.test(error.message),
  );
});

test('fetches NCDR data with a token header and keeps the token out of Raw', async () => {
  const calls = [];
  const token = 'ncdr-token-for-test';
  const snapshot = await fetchNcdrHazards({
    credentials: { apiKey: token },
    endpoint: NCDR_ENDPOINT,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ payload: ncdrPayload(), headers: { ETag: '"ncdr-1"' } });
    },
    retrievedAt: RETRIEVED_AT,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Token, token);
  assert.equal(snapshot.source_id, 'ncdr-hazard-events');
  assert.equal(snapshot.response.headers.etag, '"ncdr-1"');
  assert.doesNotMatch(JSON.stringify(snapshot), /ncdr-token-for-test/u);
});

test('normalizes NCDR CAP polygons, excludes outside hazards, and retains expired events', () => {
  const raw = rawSnapshot('ncdr-hazard-events', NCDR_ENDPOINT, ncdrPayload());
  const events = normalizeNcdrHazards(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY });

  assert.equal(events.length, 2);
  assert.equal(events[0].event_id, 'ncdr:ncdr-neihu-flood-001');
  assert.equal(events[0].event_type, 'FLOOD_WARNING');
  assert.equal(events[0].geometry.type, 'Polygon');
  assert.equal(events[0].attributes.area_id, 'neihu');
  assert.equal(events[0].attributes.theme, 'flood');
  assert.equal(events[1].event_id, 'ncdr:ncdr-expired-001');
  assert.equal(events[1].expires_at, '2026-09-02T19:00:00.000Z');
});

test('rejects an NCDR hazard with missing geometry and preserves explicit source errors', () => {
  const raw = rawSnapshot('ncdr-hazard-events', NCDR_ENDPOINT, {
    data: [{
      CAPID: 'NCDR-NO-GEOMETRY-001',
      event: '淹水警戒',
      sent: '2026-09-04T02:00:00+08:00',
      expires: '2026-09-04T03:00:00+08:00',
      areaDesc: '臺東縣',
    }],
  });
  assert.throws(
    () => normalizeNcdrHazards(raw, { boundary: OFFICIAL_NEIHU_BOUNDARY }),
    (error) => error instanceof NcdrSourceError && /GEOMETRY/u.test(error.code),
  );
});
