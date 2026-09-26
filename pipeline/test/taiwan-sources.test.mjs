import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isGeometryInBoundary, filterRecordsToBoundary } from '../lib/geo.mjs';
import { makeRawSnapshot } from '../lib/source.mjs';
import { parseOdsXml } from '../lib/feature-source.mjs';
import { createAreaResolvers, normalizeAreaCatalog } from '../sources/areas.mjs';
import {
  fetchNcdrHazards,
  normalizeNcdrHazards,
} from '../sources/ncdr.mjs';
import {
  normalizeCwaEarthquakes,
} from '../sources/cwa.mjs';
import {
  normalizeTdxRoadEvents,
} from '../sources/tdx.mjs';
import { normalizeOsmFeatures } from '../sources/osm.mjs';
import { fetchShelterStatuses, normalizeShelterStatuses, normalizeShelters } from '../sources/shelter.mjs';
import {
  mergeMedicalCoordinates,
  normalizeMedicalFacilitiesReport,
} from '../sources/medical.mjs';

const RETRIEVED_AT = '2026-09-25T00:00:00Z';
const EXPIRES_AT = '2026-10-25T00:00:00Z';

const TAIWAN_SCOPE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { COUNTYCODE: '63000', COUNTYNAME: '臺北市', TOWNCODE: '63000010', TOWNNAME: '內湖區' },
      geometry: { type: 'Polygon', coordinates: [[[121.50, 25.00], [121.65, 25.00], [121.65, 25.15], [121.50, 25.15], [121.50, 25.00]]] },
    },
    {
      type: 'Feature',
      properties: { COUNTYCODE: '10015', COUNTYNAME: '花蓮縣', TOWNCODE: '10015010', TOWNNAME: '花蓮市' },
      geometry: { type: 'Polygon', coordinates: [[[121.55, 23.90], [121.70, 23.90], [121.70, 24.10], [121.55, 24.10], [121.55, 23.90]]] },
    },
  ],
};

function rawSnapshot(sourceId, payload, endpoint = `https://example.test/${sourceId}`) {
  return makeRawSnapshot({
    sourceId,
    request: { method: 'GET', url: endpoint, query: {} },
    responseStatus: 200,
    responseHeaders: { ETag: '"taiwan-test-1"' },
    retrievedAt: RETRIEVED_AT,
    payload,
  });
}

function response(payload) {
  return {
    status: 200,
    headers: new Headers({ ETag: '"live-1"' }),
    async json() { return payload; },
  };
}

test('generic boundary helpers retain features across Taiwan administrative areas', () => {
  const records = [
    { id: 'taipei', geometry: { type: 'Point', coordinates: [121.58, 25.08] } },
    { id: 'hualien', geometry: { type: 'Point', coordinates: [121.61, 24.02] } },
    { id: 'outside', geometry: { type: 'Point', coordinates: [120.00, 22.00] } },
  ];

  assert.equal(isGeometryInBoundary(records[0].geometry, TAIWAN_SCOPE), true);
  assert.equal(isGeometryInBoundary(records[1].geometry, TAIWAN_SCOPE), true);
  assert.deepEqual(
    filterRecordsToBoundary(records, TAIWAN_SCOPE).map((record) => record.id),
    ['taipei', 'hualien'],
  );
});

test('normalizes nationwide administrative boundaries into an AreaCatalog', () => {
  const catalog = normalizeAreaCatalog(TAIWAN_SCOPE, {
    retrievedAt: RETRIEVED_AT,
    source: 'NLSC',
    sourceVersion: 'boundary-test-1',
  });

  assert.equal(catalog.schema_version, 'area-catalog-v0');
  assert.equal(catalog.coverage, 'TW');
  assert.deepEqual(new Set(catalog.areas.map((area) => area.town_code)), new Set(['63000010', '10015010']));
  assert.ok(catalog.areas.some((area) => area.area_id === 'tw.63000010'));

  const resolvers = createAreaResolvers(catalog);
  assert.equal(
    resolvers.areaIdResolver({ 縣市及鄉鎮市區: '花蓮縣花蓮市' }, { type: 'Point', coordinates: [121.61, 24.02] }),
    'tw.10015010',
  );
  assert.equal(
    resolvers.boundaryResolver({ 縣市及鄉鎮市區: '臺北市內湖區' }, { type: 'Point', coordinates: [121.58, 25.08] }).type,
    'Feature',
  );
});

test('parses the MOHW ODS medical master table into records', () => {
  const xml = `
    <table:table-row xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
      <table:table-cell><text:p>機構代碼</text:p></table:table-cell>
      <table:table-cell><text:p>機構名稱</text:p></table:table-cell>
      <table:table-cell><text:p>縣市區名</text:p></table:table-cell>
      <table:table-cell table:number-columns-repeated="16351"/>
    </table:table-row>
    <table:table-row xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
      <table:table-cell><text:p>H001</text:p></table:table-cell>
      <table:table-cell><text:p>花蓮醫院</text:p></table:table-cell>
      <table:table-cell><text:p>花蓮縣花蓮市</text:p></table:table-cell>
      <table:table-cell table:number-columns-repeated="16351"/>
    </table:table-row>`;

  assert.deepEqual(parseOdsXml(xml), [{ 機構代碼: 'H001', 機構名稱: '花蓮醫院', 縣市區名: '花蓮縣花蓮市' }]);
});

test('CWA nationwide normalization keeps records outside the old Neihu area', () => {
  const raw = rawSnapshot('cwa-earthquake', {
    result: {
      records: [
        {
          EarthquakeNo: 'TW-001',
          IssueTime: RETRIEVED_AT,
          EndTime: EXPIRES_AT,
          OriginTime: RETRIEVED_AT,
          EpicenterLatitude: '25.08',
          EpicenterLongitude: '121.58',
          StationLatitude: '25.08',
          StationLongitude: '121.58',
          StationID: 'TP-001',
          CountyName: '臺北市',
        },
        {
          EarthquakeNo: 'TW-002',
          IssueTime: RETRIEVED_AT,
          EndTime: EXPIRES_AT,
          OriginTime: RETRIEVED_AT,
          EpicenterLatitude: '24.02',
          EpicenterLongitude: '121.61',
          StationLatitude: '24.02',
          StationLongitude: '121.61',
          StationID: 'HL-001',
          CountyName: '花蓮縣',
        },
      ],
    },
  });

  const events = normalizeCwaEarthquakes(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    coverage: 'TW',
    areaId: 'tw',
  });

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.attributes.coverage), ['TW', 'TW']);
  assert.deepEqual(events.map((event) => event.attributes.area_id), ['tw', 'tw']);
});

test('normalizes the official nested CWA earthquake record shape', () => {
  const raw = rawSnapshot('cwa-earthquake', {
    records: {
      Earthquake: [{
        IssueTime: '2026-09-22T05:19:16+08:00',
        ValidTime: { EndTime: '2026-09-22T13:19:16+08:00' },
        EarthquakeNo: 115064,
        EarthquakeInfo: {
          OriginTime: '2026-09-22T05:16:13+08:00',
          Epicenter: { EpicenterLatitude: 23.21, EpicenterLongitude: 120.54 },
        },
      }],
    },
  });
  const events = normalizeCwaEarthquakes(raw, {
    boundary: { type: 'Polygon', coordinates: [[[119, 21], [122.5, 21], [122.5, 26.5], [119, 26.5], [119, 21]]] },
    scope: 'taiwan',
    coverage: 'TW',
    areaId: 'tw',
  });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].geometry, { type: 'Point', coordinates: [120.54, 23.21] });
  assert.equal(events[0].issued_at, '2026-09-21T21:16:13.000Z');
  assert.equal(events[0].expires_at, '2026-09-22T05:19:16.000Z');
});

test('NCDR alert API mode sends apikey in the query and redacts it from Raw', async () => {
  const calls = [];
  const key = 'real-alert-key-for-test';
  const snapshot = await fetchNcdrHazards({
    credentials: { apiKey: key },
    endpoint: 'https://alerts.ncdr.nat.gov.tw/webapi/api/datastore',
    authMode: 'query',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ data: [] });
    },
    retrievedAt: RETRIEVED_AT,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /apikey=real-alert-key-for-test/u);
  assert.equal(calls[0].init.headers.Token, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /real-alert-key-for-test/u);
});

test('NCDR nationwide normalization retains a Hualien alert', () => {
  const raw = rawSnapshot('ncdr-hazard-events', {
    data: [{
      CAPID: 'NCDR-HUALIEN-001',
      event: '土石流警戒',
      sent: RETRIEVED_AT,
      expires: EXPIRES_AT,
      geometry: { type: 'Point', coordinates: [121.61, 24.02] },
      areaDesc: '花蓮縣花蓮市',
    }],
  });
  const events = normalizeNcdrHazards(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    coverage: 'TW',
    areaId: 'tw',
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].attributes.coverage, 'TW');
  assert.equal(events[0].attributes.area_id, 'tw');
});

test('TDX nationwide normalization keeps all in-scope cities and adds chunk fields', () => {
  const raw = rawSnapshot('tdx-road-events', {
    UpdateTime: RETRIEVED_AT,
    Events: [
      {
        EventID: 'TDX-TAIPEI-001',
        EventType: 'Accident',
        StartTime: RETRIEVED_AT,
        EndTime: EXPIRES_AT,
        Location: { Position: { PositionLat: 25.08, PositionLon: 121.58 }, Address: { Town: '內湖區' } },
      },
      {
        EventID: 'TDX-HUALIEN-001',
        EventType: 'Construction',
        StartTime: RETRIEVED_AT,
        EndTime: EXPIRES_AT,
        Location: { Position: { PositionLat: 24.02, PositionLon: 121.61 }, Address: { Town: '花蓮市' } },
      },
    ],
  });
  const events = normalizeTdxRoadEvents(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    coverage: 'TW',
    areaId: 'tw',
  });

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.attributes.area_id), ['tw', 'tw']);
  assert.deepEqual(events.map((event) => event.attributes.theme), ['road', 'road']);
});

test('nationwide shelter normalization does not filter by Neihu text', () => {
  const raw = rawSnapshot('taiwan-shelter', {
    records: [
      {
        序號: 'TP-001', 縣市及鄉鎮市區: '臺北市內湖區', 避難收容處所地址: '內湖路1號',
        經度: '121.58', 緯度: '25.08', 避難收容處所名稱: '台北避難所', 預計收容人數: '100',
      },
      {
        序號: 'HL-001', 縣市及鄉鎮市區: '花蓮縣花蓮市', 避難收容處所地址: '花蓮路1號',
        經度: '121.61', 緯度: '24.02', 避難收容處所名稱: '花蓮避難所', 預計收容人數: '200',
      },
    ],
  });
  const normalized = normalizeShelters(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-shelter',
    source: 'FIRE_AGENCY',
    datasetId: 'resilientgeo-taiwan',
    coverage: 'TW',
  });

  assert.equal(normalized.features.length, 2);
  assert.deepEqual(normalized.features.map((feature) => feature.properties.coverage), ['TW', 'TW']);
});

test('nationwide OSM normalization keeps non-Neihu POIs with Taiwan metadata', () => {
  const raw = rawSnapshot('osm-taiwan', {
    version: 0.6,
    osm3s: { timestamp_osm_base: RETRIEVED_AT },
    elements: [{
      type: 'node',
      id: 9001,
      lat: 24.02,
      lon: 121.61,
      tags: { amenity: 'hospital', name: '花蓮醫院' },
    }],
  });
  const resolvers = createAreaResolvers(normalizeAreaCatalog(TAIWAN_SCOPE));
  const features = normalizeOsmFeatures(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'osm-taiwan',
    coverage: 'TW',
    ...resolvers,
  });

  assert.equal(features.length, 1);
  assert.equal(features[0].properties.coverage, 'TW');
  assert.equal(features[0].properties.area_id, 'tw.10015010');
  assert.equal(features[0].properties.county_code, '10015');
  assert.equal(features[0].properties.town_code, '10015010');
});

test('shelter status feed emits OPEN/FULL/CLOSED events and keeps unknown status explicit', () => {
  const raw = rawSnapshot('taiwan-shelter-status', {
    records: [
      {
        shelterCode: 'TP-001', name: '台北避難所', county: '臺北市', town: '內湖區',
        address: '內湖路1號', lon: '121.58', lat: '25.08', openstatus: '開設',
      },
      {
        shelterCode: 'HL-001', name: '花蓮避難所', county: '花蓮縣', town: '花蓮市',
        address: '花蓮路1號', lon: '121.61', lat: '24.02', openstatus: '已滿',
      },
      {
        shelterCode: 'HL-002', name: '花蓮避難所2', county: '花蓮縣', town: '花蓮市',
        address: '花蓮路2號', lon: '121.62', lat: '24.03',
      },
    ],
  });
  const events = normalizeShelterStatuses(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-shelter-status',
    coverage: 'TW',
    expiresAt: EXPIRES_AT,
  });

  assert.deepEqual(new Set(events.map((event) => event.attributes.status)), new Set(['UNKNOWN', 'FULL', 'OPEN']));
  assert.deepEqual(new Set(events.map((event) => event.attributes.coverage)), new Set(['TW']));
  assert.deepEqual(new Set(events.map((event) => event.attributes.shelter_id)), new Set(['tp-001', 'hl-001', 'hl-002']));
});

test('shelter status XML fetch parses the official lowercase field names without credentials', async () => {
  const raw = await fetchShelterStatuses({
    endpoint: 'https://portal2.emic.gov.tw/Pub/EEA2/OpenData/Shelter.xml',
    retrievedAt: RETRIEVED_AT,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ ETag: '"status-1"' }),
      async text() {
        return '<root><shelter><shelterCode>S-1</shelterCode><county>花蓮縣</county><town>花蓮市</town><lat>24.02</lat><lon>121.61</lon><openstatus>開設</openstatus></shelter></root>';
      },
    }),
  });

  assert.equal(raw.source_id, 'taiwan-shelter-status');
  assert.equal(raw.payload.records[0].shelterCode, 'S-1');
  assert.doesNotMatch(JSON.stringify(raw), /apikey|token|secret/iu);
});

test('shelter status XML parser handles the official nested ShletersInfo wrapper', async () => {
  const raw = await fetchShelterStatuses({
    endpoint: 'https://portal2.emic.gov.tw/Pub/EEA2/OpenData/Shelter.xml',
    retrievedAt: RETRIEVED_AT,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers(),
      async text() {
        return '<SheltersInfoList><ShletersInfo><ShletersInfo><shelterCode>S-2</shelterCode><county>花蓮縣</county><town>花蓮市</town><lat>24.02</lat><lon>121.61</lon><openstatus>撤除</openstatus></ShletersInfo><ShletersInfo><shelterCode>S-2</shelterCode><county>花蓮縣</county><town>花蓮市</town><lat>24.02</lat><lon>121.61</lon><openstatus>撤除</openstatus></ShletersInfo></ShletersInfo></SheltersInfoList>';
      },
    }),
  });

  assert.equal(raw.payload.records.length, 1);
  assert.equal(raw.payload.records[0].shelterCode, 'S-2');
  const events = normalizeShelterStatuses(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-shelter-status',
    coverage: 'TW',
    expiresAt: EXPIRES_AT,
  });
  assert.equal(events[0].attributes.status, 'CLOSED');
  assert.equal(events[0].attributes.shelter_id, 's-2');
});

test('medical normalization reports unresolved nationwide rows instead of inventing coordinates', () => {
  const raw = rawSnapshot('taiwan-medical', {
    records: [
      { 機構代碼: 'H001', 機構名稱: '台北醫院', 縣市鄉鎮: '臺北市內湖區', 地址: '內湖路1號' },
      { 機構代碼: 'H002', 機構名稱: '花蓮醫院', 縣市鄉鎮: '花蓮縣花蓮市', 地址: '花蓮路1號', 經度: '121.61', 緯度: '24.02' },
    ],
  });
  const report = normalizeMedicalFacilitiesReport(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-medical',
    source: 'MOHW',
    datasetId: 'resilientgeo-taiwan',
    coverage: 'TW',
    expiresAt: EXPIRES_AT,
  });

  assert.equal(report.features.length, 1);
  assert.equal(report.unresolved.length, 1);
  assert.equal(report.unresolved[0].medical_id, 'h001');
  assert.equal(report.unresolved[0].geometry_status, 'unresolved');
  assert.equal(report.features[0].properties.coverage, 'TW');
});

test('medical coordinate supplement resolves only an unambiguous OSM name match', () => {
  const raw = rawSnapshot('taiwan-medical', {
    records: [{
      機構代碼: 'H001', 機構名稱: '台北醫院', 縣市鄉鎮: '臺北市內湖區', 地址: '內湖路1號',
    }],
  });
  const report = normalizeMedicalFacilitiesReport(raw, {
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-medical',
    coverage: 'TW',
    expiresAt: EXPIRES_AT,
  });
  const merged = mergeMedicalCoordinates(report, [{
    layer_id: 'osm-poi',
    feature_type: 'HOSPITAL',
    geometry: { type: 'Point', coordinates: [121.58, 25.08] },
    properties: { name: '台北醫院', address: '內湖路1號' },
  }], {
    rawSnapshot: raw,
    boundary: TAIWAN_SCOPE,
    scope: 'taiwan',
    sourceId: 'taiwan-medical',
    coverage: 'TW',
    expiresAt: EXPIRES_AT,
  });

  assert.equal(merged.features.length, 1);
  assert.equal(merged.unresolved.length, 0);
  assert.deepEqual(merged.features[0].geometry, { type: 'Point', coordinates: [121.58, 25.08] });
});
