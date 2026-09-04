# A 組內湖分層資料管線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 A 組負責的內湖區資料管線，盤點全部 OSSInt 資料來源，將可共享資料分成 Dynamic Event、Static Feature、Static Raster 三種產品，完成 P1 真實資料接入、正規化、驗證、簽章、fixture 與交付契約。

**Architecture:** 保留目前 `event-v0`、`manifest-v0`、`chunk-v0` 作為動態事件的相容契約；新增靜態向量資料的 `feature-v0` 與 layer package 契約，不把 OSM、避難所、醫院或 DEM 強行轉成事件。所有 Collector 先保存不可變 Raw snapshot，再進行內湖範圍過濾與欄位正規化；A 只產出可靠資料與封包，不負責 Android GPS、地圖 UI、Peer Sync 或後續風險分析。

**Tech Stack:** Node.js ESM、Node built-ins、JSON Schema Draft 2020-12、GeoJSON/WGS84、HTTP `fetch`、SHA-256、Ed25519；不在 repository 保存 API key、private key 或未授權資料。

**Spec:** `system.md`、`OSSInt 3c0b9710cc95808395c5c1e3b9764d62.md`、`docs/data-contract-v0.md`

## Global Constraints

- GNSS / GPS 是 Android 裝置本機感測資料，不建立 A 的外部 Collector，也不進入共享資料封包。
- 全部 10 類資料都要完成來源盤點；P1 真正接入 OSM、避難所、醫療、TDX、CWA、NCDR。
- 動態資料使用既有 `event-v0`；靜態向量資料使用新增 `feature-v0`；Raster 先使用獨立 artifact manifest，不修改既有事件契約。
- Collector 只做取得、Raw 保存、區域篩選、欄位／座標／時間正規化與資料品質驗證；不計算坡度風險、孤立風險、避難指標、資料覆蓋率、路線或統計分析。
- 所有資料保留 `source`、`source_version`、`retrieved_at`、`issued_at` 或 `observed_at`、`expires_at`、原始來源與抓取方式。
- GeoJSON 座標使用 WGS84、`[longitude, latitude]`；缺值使用 JSON `null`，不以 0 代替。
- 官方資料、OSM 資料與群眾回報使用不同 namespace；群眾資料標記為 `unverified`，不能覆蓋官方資料。
- Live API、scheduled download、local fixture 必須在 metadata 中分開標示；靜態下載不可描述成即時 API。
- Raw snapshot 與 fixture 不得包含 API key、Authorization header、private key 或個人 GPS。
- 每個 Collector 以注入的 `fetchImpl` 測試，不在一般單元測試依賴外部網路；另提供明確標示的 live smoke command。
- 保持目前 `npm test`、既有 Node pipeline 測試與 Python replay 測試可通過。

---

## 1. A 的範圍與資料產品

### 1.1 資料分類

| 資料 | A 的交付類型 | P1 狀態 | 備註 |
| --- | --- | --- | --- |
| GNSS / GPS | 不交付外部資料；提供介面說明 | 排除 Collector | Android 取得後只留本機 |
| OpenStreetMap | `Static Feature` | 實際接入 | 內湖道路、基礎 POI、路網資料 |
| TDX | `Dynamic Event` | 實際接入 | 道路封閉、事故、交通事件 |
| CWA | `Dynamic Event` | 實際接入 | 地震、豪雨、颱風、警特報 |
| NCDR | `Dynamic Event`／`Static Layer` | 實際接入 | 淹水、土石流、災情點位；可取得性依資料服務權限記錄 |
| 消防署／臺北市避難所 | `Static Feature`＋狀態 `Dynamic Event` | 實際接入 | 位置、容量、開設狀態分開保存 |
| 醫療資料 | `Static Feature` | 實際接入 | 醫院、電話、經緯度、服務欄位 |
| DEM / DSM | `Static Raster` | 來源盤點＋樣本 | 高程資料先保存，分析另案處理 |
| 網路資料 | `Static Layer`／`Dynamic Event` | 來源盤點＋樣本 | 覆蓋、基地台或中斷資料依可用來源決定 |
| SAR / 光學影像 | `Static Raster`／災害 `Dynamic Event` | 來源盤點＋樣本 | 先保存影像 metadata 與災害範圍，不做影像判釋 |

### 1.2 不變的責任邊界

```text
A：來源、Raw、Collector、正規化、品質驗證、封裝與 fixture
 B：Android 本機資料庫、GNSS、離線地圖與 UI
 C：BLE／P2P、HELLO → DIFF → REQUEST、Store-Carry-Forward
 D：模擬情境、Coverage、Freshness Lag、流量與耗電實驗
```

### 1.3 內湖 Demo 的完成條件

- source catalog 包含全部 10 類資料；GNSS 明確標記為 `device_local`，只出現在本機資料清單，不出現在外部 Collector 清單。
- P1 六類來源至少各有一個可重播 Raw snapshot、正規化輸出與品質驗證結果。
- 動態 fixture 至少包含 100 筆、目標擴充至 1,000 筆道路／災害／避難狀態資料及更新序列。
- 任何事件或 feature 都能回答：來源、版本、抓取時間、有效時間、內湖範圍、信任狀態。
- 合法封包可通過 Hash／簽章驗證；竄改、未知來源、版本倒退、過期與不完整資料會被正確拒絕或標示。

## 2. 檔案結構與責任

### 2.1 建立的檔案

- `pipeline/sources/catalog.json`：全部資料源的來源註冊表，不存秘密。
- `pipeline/sources/boundaries/taipei-neihu.geojson`：內湖範圍快照與來源 metadata。
- `pipeline/lib/source.mjs`：Raw snapshot、HTTP metadata、重試與錯誤分類共用邏輯。
- `pipeline/lib/geo.mjs`：WGS84 GeoJSON 驗證、內湖範圍判斷與保守裁切。
- `pipeline/lib/feature-contract.mjs`：`feature-v0` 的 hash、簽章、驗證與狀態判定。
- `pipeline/lib/feature-bundle.mjs`：靜態向量 feature 的 manifest、chunk 與 bundle 建立。
- `pipeline/sources/tdx.mjs`：TDX 道路事件取得與正規化。
- `pipeline/sources/cwa.mjs`：CWA 地震與天氣警特報取得與正規化。
- `pipeline/sources/ncdr.mjs`：NCDR 淹水、土石流與災情資料取得與正規化。
- `pipeline/sources/osm.mjs`：OSM 內湖道路／POI snapshot 取得與正規化。
- `pipeline/sources/shelter.mjs`：避難所資料取得、欄位正規化與狀態拆分。
- `pipeline/sources/medical.mjs`：醫療資料取得與正規化。
- `schemas/feature-v0.schema.json`：靜態向量 feature 契約。
- `schemas/layer-manifest-v0.schema.json`：靜態 layer package 索引契約。
- `schemas/layer-chunk-v0.schema.json`：靜態 feature chunk 契約。
- `data/fixtures/neihu/`：內湖 Raw snapshot、normalized records、更新序列與預期結果。

### 2.2 修改的檔案

- `schemas/event-v0.schema.json`：只在確認動態來源需要時補充 source-specific contract 說明，不改動既有必填欄位的語意。
- `schemas/manifest-v0.schema.json`、`schemas/chunk-v0.schema.json`：保持事件 bundle v0 相容，不改成靜態資料契約。
- `pipeline/lib/canonical.mjs`：若 feature signing 需要共用 canonical 規則，抽出不影響事件 hash 的共用函式。
- `pipeline/cli.mjs`：新增來源盤點、Collector、靜態 layer build／verify 與 Neihu replay 命令；既有 TDX `build`／`verify` 行為保持不變。
- `pipeline/README.md`：補上資料分層、秘密管理、live smoke 與內湖 demo 命令。
- `docs/data-contract-v0.md`：補充 Event 與 Static Feature 的差異及交付契約。
- `docs/peer-sync-v0.md`：標明 C 目前同步 `event-v0`，靜態 layer 的同步介面另以 layer manifest 對接。

### 2.3 測試檔案

- `pipeline/test/schema.test.mjs`
- `pipeline/test/source.test.mjs`
- `pipeline/test/tdx.test.mjs`
- `pipeline/test/cwa-ncdr.test.mjs`
- `pipeline/test/static-sources.test.mjs`
- `pipeline/test/feature-contract.test.mjs`
- `pipeline/test/neihu-replay.test.mjs`

## 3. Task 1：建立來源註冊表與資料契約

**Files:**

- Create: `pipeline/sources/catalog.json`
- Create: `schemas/feature-v0.schema.json`
- Create: `schemas/layer-manifest-v0.schema.json`
- Create: `schemas/layer-chunk-v0.schema.json`
- Create: `pipeline/test/schema.test.mjs`
- Modify: `docs/data-contract-v0.md`

**Interfaces:**

- Produces `catalog.json` entries with `source_id`, `data_product`, `access_mode`, `endpoint_or_url`, `format`, `coverage`, `update_frequency`, `auth_required`, `license`, `coordinate_system`, `ttl_policy`, and `integration_stage`.
- Produces `feature-v0` records with `dataset_id`, `layer_id`, `feature_id`, `feature_type`, `geometry`, `properties`, `source`, `source_version`, `issued_at`, `expires_at`, `payload_hash`, `signature`, `signature_algorithm`, `signing_key_id`, and `provenance`.
- Produces `layer-manifest-v0` and `layer-chunk-v0` contracts for static vector packages; existing event manifest/chunk contracts remain unchanged.

- [x] **Step 1: Write the source catalog entries**

  Completed 2026-09-04. Online research, Neihu applicability, access restrictions and point-in-time verification are recorded in `docs/neihu-online-data-sources.md`; Collector implementation has not started.

  The catalog must contain these external `source_id` values plus one `device_local` GNSS architecture entry; GNSS must not have an external Collector:

  ```json
  [
    {"source_id":"gnss-gps","data_product":"local_context","access_mode":"device_local","integration_stage":"B"},
    {"source_id":"osm-neihu","data_product":"static_feature","access_mode":"scheduled_download","integration_stage":"P1"},
    {"source_id":"tdx-road-events","data_product":"dynamic_event","access_mode":"live_api","integration_stage":"P1"},
    {"source_id":"cwa-earthquake","data_product":"dynamic_event","access_mode":"live_api","integration_stage":"P1"},
    {"source_id":"cwa-weather-warning","data_product":"dynamic_event","access_mode":"live_api","integration_stage":"P1"},
    {"source_id":"ncdr-hazard-events","data_product":"dynamic_event","access_mode":"live_api_or_download","integration_stage":"P1"},
    {"source_id":"taipei-shelter","data_product":"static_feature","access_mode":"scheduled_download","integration_stage":"P1"},
    {"source_id":"taipei-medical","data_product":"static_feature","access_mode":"scheduled_download","integration_stage":"P1"},
    {"source_id":"dem-dsm-neihu","data_product":"static_raster","access_mode":"scheduled_download","integration_stage":"P2"},
    {"source_id":"network-neihu","data_product":"static_layer","access_mode":"scheduled_download","integration_stage":"P2"},
    {"source_id":"sar-optical-neihu","data_product":"static_raster","access_mode":"scheduled_download","integration_stage":"P3"}
  ]
  ```

- [x] **Step 2: Define the minimum `feature-v0` shape**

  The schema must reject missing identity, geometry, provenance, version, time and trust fields. The logical identity is `(namespace, layer_id, feature_id)`; source-specific values stay inside `properties`.

  ```json
  {
    "schema_version": "feature-v0",
    "namespace": "official.taipei",
    "dataset_id": "resilientgeo-neihu",
    "layer_id": "shelter",
    "feature_id": "shelter:neihu:001",
    "feature_type": "SHELTER",
    "geometry": {"type":"Point","coordinates":[121.58,25.08]},
    "properties": {"name":"demo shelter","capacity":300},
    "source": "taipei-shelter",
    "source_version": "snapshot-2026-09-04",
    "issued_at": "2026-09-04T00:00:00Z",
    "expires_at": "2026-09-11T00:00:00Z",
    "provenance": {"original_source":"official-url","received_at":"2026-09-04T00:05:00Z","transport_source":{"kind":"server","node_id":"source-collector"}}
  }
  ```

- [x] **Step 3: Add schema tests**

  Test one valid feature, missing `feature_id`, invalid GeoJSON geometry, invalid timestamp, and missing provenance. Test that `catalog.json` contains all 10 categories, contains exactly one `gnss-gps` entry with `access_mode: "device_local"`, and excludes GNSS from external Collector IDs.

- [x] **Step 4: Run the schema tests**

  Run: `node --test pipeline/test/schema.test.mjs`

  Expected: PASS for valid records and expected rejection for invalid records.

- [x] **Step 5: Commit the contract unit**

  ```bash
  git add pipeline/sources/catalog.json schemas/feature-v0.schema.json schemas/layer-manifest-v0.schema.json schemas/layer-chunk-v0.schema.json pipeline/test/schema.test.mjs docs/data-contract-v0.md
  git commit -m "feat: define layered Neihu data contracts"
  ```

## 4. Task 2：建立 Raw snapshot 與內湖範圍共用層

**Files:**

- Create: `pipeline/lib/source.mjs`
- Create: `pipeline/lib/geo.mjs`
- Create: `pipeline/sources/boundaries/taipei-neihu.geojson`
- Create: `pipeline/test/source.test.mjs`

**Interfaces:**

- `makeRawSnapshot({ sourceId, request, responseStatus, responseHeaders, retrievedAt, payload }) -> RawSnapshot`
- `requestJson(url, { fetchImpl, headers, timeoutMs, maxAttempts }) -> Promise<{ status, headers, payload }>`
- `validateRawSnapshot(snapshot) -> string[]`
- `isGeometryInNeihu(geometry, boundary) -> boolean`
- `filterRecordsToNeihu(records, boundary, getGeometry) -> records[]`
- `normalizeCoordinate([longitude, latitude]) -> [number, number]`

- [x] **Step 1: Add deterministic Raw snapshot tests**

  Test that request metadata strips `Authorization`, `X-Api-Key` and `Client-Secret`; response status and `ETag`／`Last-Modified` are retained; a failed HTTP response produces a typed error without a curated record.

- [x] **Step 2: Implement Raw snapshot creation**

  `makeRawSnapshot` must return:

  ```js
  {
    schema_version: 'raw-snapshot-v0',
    source_id,
    request: { method, url, query },
    response: { status, headers: { etag, last_modified, content_type } },
    retrieved_at,
    payload
  }
  ```

  The function must throw on missing `source_id`, invalid `retrieved_at`, non-object payload, or non-2xx status.

- [x] **Step 3: Add Neihu boundary filtering**

  Store the boundary as GeoJSON WGS84. Point features use point-in-polygon; line and polygon features are retained when their geometry envelope intersects the boundary envelope, preventing roads or hazard polygons that cross the district edge from being silently dropped. Each source must retain the original unfiltered Raw snapshot.

- [x] **Step 4: Test boundary and coordinate behavior**

  Test an inside point, an outside point, a line crossing the boundary, reversed latitude／longitude input rejection, and a record with no geometry. Missing geometry must be reported as a validation error, not silently included.

- [ ] **Step 5: Run tests and commit**

  Tests completed; commit intentionally skipped per user instruction. Changes remain in the working tree.

  Run: `node --test pipeline/test/source.test.mjs`

  Expected: PASS with deterministic filtering and secret-free metadata.

  ```bash
  git add pipeline/lib/source.mjs pipeline/lib/geo.mjs pipeline/sources/boundaries/taipei-neihu.geojson pipeline/test/source.test.mjs
  git commit -m "feat: add source snapshots and Neihu filtering"
  ```

## 5. Task 3：接入 TDX 道路事件

**Files:**

- Create: `pipeline/sources/tdx.mjs`
- Create: `pipeline/test/tdx.test.mjs`
- Create: `data/fixtures/neihu/tdx-raw-batch-1.json`
- Create: `data/fixtures/neihu/tdx-events-batch-1.json`
- Modify: `pipeline/cli.mjs`
- Modify: `pipeline/README.md`

**Interfaces:**

- `fetchTdxRoadEvents({ clientId, clientSecret, endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeTdxRoadEvents(rawSnapshot, { namespace, signingKeyId, boundary, receivedAt }) -> unsigned Event[]`
- `collectTdxRoadEvents(options) -> Promise<{ rawSnapshot, events }>`

- [ ] **Step 1: Record the real TDX response shape**

  Pending authenticated capture: no TDX credentials were available in this run. A sanitized `local_fixture` with the official compact/WKT response shape was added at `data/fixtures/neihu/tdx-raw-batch-1.json`; it is not presented as a live response. The live capture still must record the endpoint, retrieval time, response version／ETag and raw SHA-256 without auth headers or secrets.

- [x] **Step 2: Write failing normalization tests**

  Assert that one road event becomes an unsigned `event-v0` record with `namespace: "official.tdx"`, deterministic `event_id`, GeoJSON geometry, source version, `issued_at`, `expires_at`, and provenance. Include a road event outside Neihu and assert it is excluded from curated output but remains in Raw.

- [x] **Step 3: Implement the TDX adapter**

  Reuse the existing `normalizeTdx` semantics while adapting the real response envelope. Do not calculate route cost, congestion index or district statistics. Preserve unmapped source fields inside `attributes` and reject records without stable identity, geometry or valid source time.

- [x] **Step 4: Add live／fixture CLI paths**

  Add commands with explicit modes:

  ```text
  node pipeline/cli.mjs collect --source tdx-road-events --out-dir <raw-dir>
  node pipeline/cli.mjs normalize --source tdx-road-events --input <raw.json> --out <events.json>
  ```

  The live command must fail with a clear missing-credential error; the fixture command must work without credentials.

- [x] **Step 5: Test, build and verify the event bundle**

  Run: `node --test pipeline/test/tdx.test.mjs pipeline/test/pipeline.test.mjs`

  Then run the existing keygen → build → verify flow with the TDX fixture. Expected: all existing tests remain green and the real-shaped fixture produces a valid signed Event bundle.

  Commit intentionally skipped per user instruction; all changes remain in the working tree.

## 6. Task 4：接入 CWA 與 NCDR 動態災害資料

**Files:**

- Create: `pipeline/sources/cwa.mjs`
- Create: `pipeline/sources/ncdr.mjs`
- Create: `pipeline/test/cwa-ncdr.test.mjs`
- Create: `data/fixtures/neihu/cwa-earthquake-raw.json`
- Create: `data/fixtures/neihu/cwa-warning-raw.json`
- Create: `data/fixtures/neihu/ncdr-hazard-raw.json`
- Create: `data/fixtures/neihu/cwa-events.json`
- Create: `data/fixtures/neihu/ncdr-events.json`
- Create: `pipeline/test/cli.test.mjs`
- Modify: `pipeline/.env.example`, `pipeline/cli.mjs`, `pipeline/lib/source.mjs`, `pipeline/README.md`
- Modify: `pipeline/sources/catalog.json`

**Interfaces:**

- `fetchCwaEarthquakes({ apiKey, endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `fetchCwaWarnings({ apiKey, endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeCwaEarthquakes(rawSnapshot, options) -> unsigned Event[]`
- `normalizeCwaWarnings(rawSnapshot, options) -> unsigned Event[]`
- `fetchNcdrHazards({ credentials, endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeNcdrHazards(rawSnapshot, options) -> unsigned Event[]`

- [x] **Step 1: Select and document exact datasets**

  Use the CWA earthquake／weather warning dataset IDs and the NCDR dataset or service actually available to the project account. Record access mode, authentication, format, update frequency and permission limitations in `catalog.json`; do not claim NCDR is live when the available source is a downloadable snapshot or restricted service.

- [x] **Step 2: Add fixture-driven failure cases**

  Test malformed time, missing geometry, invalid source ID, an event outside Neihu, and an expired warning. A valid warning must remain an event with `expires_at`; an expired event may remain cached but must not be marked current.

- [x] **Step 3: Implement source-specific normalization**

  Map CWA／NCDR source records to stable event IDs and uppercase event types. Preserve the original alert number, source description, affected area and original unit inside `attributes`; do not convert an alert into a self-invented risk score.

- [x] **Step 4: Add authentication-safe live commands**

  Read CWA credentials from `CWA_API_KEY` and NCDR credentials from the configured runtime environment. Ensure sanitized Raw metadata never contains those values. A missing or unauthorized source must produce a source-status result and non-zero smoke exit code rather than an empty successful dataset.

- [x] **Step 5: Run tests; commit remains user-authorized**

  Run: `node --test pipeline/test/cwa-ncdr.test.mjs pipeline/test/pipeline.test.mjs`

  Expected: valid fixture events normalize and sign; invalid and out-of-area records are rejected or excluded with explicit reasons.

  ```bash
  # Commit only after reviewing the mixed worktree and receiving explicit approval.
  ```

## 7. Task 5：接入 OSM、避難所與醫療 Static Feature

**Files:**

- Create: `pipeline/sources/osm.mjs`
- Create: `pipeline/sources/shelter.mjs`
- Create: `pipeline/sources/medical.mjs`
- Create: `pipeline/test/static-sources.test.mjs`
- Create: `data/fixtures/neihu/osm-raw.json`
- Create: `data/fixtures/neihu/shelter-raw.json`
- Create: `data/fixtures/neihu/medical-raw.json`
- Create: `data/fixtures/neihu/features.json`
- Create: `pipeline/lib/feature-contract.mjs`
- Create: `pipeline/lib/feature-bundle.mjs`
- Modify: `pipeline/cli.mjs`

**Interfaces:**

- `fetchOsmNeihu({ endpoint, query, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeOsmFeatures(rawSnapshot, options) -> unsigned Feature[]`
- `fetchShelters({ endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeShelters(rawSnapshot, options) -> { features: unsigned Feature[], statusEvents: unsigned Event[] }`
- `fetchMedicalFacilities({ endpoint, fetchImpl, retrievedAt }) -> Promise<RawSnapshot>`
- `normalizeMedicalFacilities(rawSnapshot, options) -> unsigned Feature[]`
- `signFeature(feature, privateKey) -> signed Feature`
- `verifyFeature(feature, publicKey, options) -> VerificationResult`
- `buildFeatureBundle(features, options) -> { manifest, chunks }`
- `verifyFeatureBundle(bundle, publicKey, options) -> VerificationResult`

- [x] **Step 1: Write static feature tests**

  Assert that OSM road／POI, shelter and hospital records become `feature-v0` with stable `feature_id`, `layer_id`, WGS84 geometry, source properties and provenance. Assert that shelter location and capacity are static properties while open／full／closed status becomes a separate event.

- [x] **Step 2: Implement feature signing without changing event v0**

  Reuse `signCanonical`, `verifyCanonical`, SHA-256 and trusted key handling. Keep feature signing input separate from `eventPayload` so an existing event hash cannot change. Reject a feature before bundle creation if its geometry, identity, time or source metadata is invalid.

- [x] **Step 3: Implement static source normalizers**

  Preserve original OSM tags, shelter source columns and medical source columns in `properties.source_record`. Normalize only identifiers, coordinate order, timestamps, booleans, numeric values and field names needed by B. Do not calculate nearest shelter, route, capacity pressure or medical coverage.

- [x] **Step 4: Build and verify a static layer bundle**

  Use a separate `layer-manifest-v0`／`layer-chunk-v0` package. The manifest must identify `layer_id`, `source_version`, `record_count`, `total_size_bytes`, `bbox`, `content_hash`, expiration policy and chunk references. The existing event bundle build path must remain unchanged.

- [x] **Step 5: Run tests; commit remains user-authorized**

  Run: `npm test` and `node --test pipeline/test/static-sources.test.mjs pipeline/test/feature-contract.test.mjs pipeline/test/cli.test.mjs`

  Result: static features verify independently; shelter status is kept as a separate
  unsigned event batch for the existing event signing step; existing event tests remain green.

  ```bash
  # Commit only after reviewing the mixed worktree and receiving explicit approval.
  ```

## 8. Task 6：完成 DEM／DSM、網路與 SAR／光學資料的來源準備

**Files:**

- Modify: `pipeline/sources/catalog.json`
- Create: `pipeline/sources/raster-catalog.json`
- Create: `pipeline/lib/raster.mjs`
- Create: `pipeline/test/raster-catalog.test.mjs`
- Modify: `docs/data-contract-v0.md`

**Interfaces:**

- `validateRasterCatalogEntry(entry) -> string[]`
- `makeRasterArtifactMetadata({ sourceId, layerId, format, crs, bbox, retrievedAt, expiresAt, fileHash, accessMode }) -> RasterArtifactMetadata`

- [x] **Step 1: Create the raster／network source records**

  Each entry must include source owner, exact URL or application path, format, coordinate system, spatial extent, temporal extent, update mode, access restriction, file hash and intended use. Entries must explicitly distinguish raw data from derived risk analysis.

- [x] **Step 2: Add sample metadata without fabricating live results**

  Store a small, legally usable sample or metadata-only fixture for DEM／DSM, network and SAR／optical sources. Do not create a fake current hazard image or claim automatic satellite detection.

- [x] **Step 3: Add validation tests**

  Test missing source URL, unsupported format, invalid CRS, missing hash, invalid bbox and expired artifact metadata. Test that each of the three source IDs has a P2 or P3 stage and a non-empty limitation statement.

- [x] **Step 4: Record the handoff boundary**

  Document that A provides raster artifact metadata and source files; D or a later analytics task computes slope, isolation, coverage or image-derived hazard polygons. B receives a layer manifest rather than raw source credentials.

- [x] **Step 5: Run tests; commit remains user-authorized**

  Run: `node --test pipeline/test/raster-catalog.test.mjs`

  Expected: all advanced-source records are complete and honest about access／processing status.
  Result: the three advanced sources are registered as metadata-only (`file_hash: null` until a real artifact is downloaded); raster catalog tests pass, full Node tests pass, Python replay tests pass, and the working tree was not committed.

  ```bash
  # Commit only after reviewing the mixed worktree and receiving explicit approval.
  ```

## 9. Task 7：建立內湖整合 fixture、更新序列與 replay 驗證

**Files:**

- Create: `data/fixtures/neihu/manifest.json`
- Create: `data/fixtures/neihu/update-sequence.json`
- Create: `data/fixtures/neihu/expected-results.json`
- Create: `pipeline/lib/neihu-replay.mjs`
- Create: `pipeline/test/neihu-replay.test.mjs`
- Modify: `pipeline/README.md`
- Modify: `fixtures/README.md`

**Interfaces:**

- `loadNeihuFixture(path) -> { rawSnapshots, events, features, updates }`
- `replayNeihuFixture(fixture, now) -> { inserted, updated, expired, rejected, current, featureLayers }`
- `checkNeihuExpectations(result, expected) -> string[]`

- [x] **Step 1: Build the first Neihu fixture**

  Include at least these transitions:

  ```text
  TDX road:382         version 1 -> version 2 -> rollback version 1
  CWA warning          current -> expired
  NCDR flood point     inserted -> updated
  shelter:001          OPEN -> FULL -> CLOSED
  hospital:001         static feature unchanged across a repeated snapshot
  crowd:road:382       separate unverified namespace, never overwrites official.tdx
  ```

- [x] **Step 2: Expand records deterministically**

  Generate records from fixed IDs and fixed timestamps until the dynamic fixture contains 100 records; add a checked-in 1,000-record variant only after the 100-record replay is green. Do not generate random IDs or current-time values in tests.

- [x] **Step 3: Implement replay expectations**

  Assert idempotence, newer-version replacement, rollback rejection, expiry state, namespace isolation, static feature replacement by snapshot version, and preservation of Raw records excluded by the Neihu filter.

- [x] **Step 4: Run the complete local validation**

  ```bash
  npm test
  python -m unittest discover -s tests -v
  node --test pipeline/test/neihu-replay.test.mjs
  git diff --check
  ```

  Expected: the full Node suite, existing 4 Python tests and new Neihu replay tests pass; no whitespace errors are reported.
  Result: `npm test` passed 107 tests, Python replay passed 4 tests, the dedicated replay suite passed 5 tests, and `git diff --check` passed.

- [x] **Step 5: Review changes; commit remains user-authorized**

  ```bash
  # Commit only after reviewing the mixed worktree and receiving explicit approval.
  ```

## 10. Task 8：建立 A → B／C／D 交付文件與 live smoke 驗收

**Files:**

- Create: `docs/neihu-data-sources.md`
- Create: `docs/a-handoff-checklist.md`
- Create: `pipeline/sources/smoke.mjs`
- Modify: `pipeline/README.md`
- Modify: `docs/peer-sync-v0.md`

**Interfaces:**

- `runSourceSmoke(sourceId, options) -> Promise<{ sourceId, accessMode, status, recordCount, retrievedAt, sourceVersion, errors }>`
- Handoff manifest fields: `source_id`, `dataset_id`, `layer_id`, `source_version`, `retrieved_at`, `expires_at`, `record_count`, `raw_hash`, `content_hash`, `manifest_hash`, `signature_key_id`, `validation_status`.

- [ ] **Step 1: Write the source and handoff documentation**

  `docs/neihu-data-sources.md` must have one section per source, with official URL／API, access mode, fields, coordinate system, update policy, license, limitations and current integration stage. It must state that GNSS／GPS is an Android local input, not an A source.

- [ ] **Step 2: Implement smoke output without exposing secrets**

  The smoke command prints only source ID, status code, record count, retrieval timestamp, response version／ETag and error class. It must never print API keys, request Authorization headers, raw personal location or private key paths.

- [ ] **Step 3: Define the handoff checklist**

  B receives static layer manifests and features; C receives signed event bundles and priorities; D receives fixture paths, source timestamps and expected replay outcomes. Every handoff must identify whether data is live API, scheduled snapshot or local fixture.

- [ ] **Step 4: Run final acceptance checks**

  Run fixture validation without network, then run live smoke only when credentials and network are available. NCDR access is optional for the deadline Demo: if the account is not approved, mark it `blocked_by_access` and use the Neihu simulation/replay fixture. A source with no access must never be reported as a successful empty live source.

  ```bash
  node pipeline/sources/smoke.mjs --source tdx-road-events
  node pipeline/sources/smoke.mjs --source cwa-earthquake
  node pipeline/sources/smoke.mjs --source ncdr-hazard-events
  npm test
  python -m unittest discover -s tests -v
  git diff --check
  ```

- [ ] **Step 5: Commit the A handoff package**

  ```bash
  git add docs/neihu-data-sources.md docs/a-handoff-checklist.md pipeline/sources/smoke.mjs pipeline/README.md docs/peer-sync-v0.md
  git commit -m "docs: define Neihu data pipeline handoff"
  ```

## 11. 執行順序與停損條件

### 執行順序

```text
Task 1 契約與 catalog
  ↓
Task 2 Raw／Geo 共用層
  ↓
Task 3 TDX vertical slice
  ↓
Task 4 CWA／NCDR 動態事件
  ↓
Task 5 OSM／避難所／醫療 Static Feature
  ↓
Task 6 DEM／DSM／網路／SAR 來源準備
  ↓
Task 7 fixture／replay／安全驗證
  ↓
Task 8 A → B／C／D 交付與 live smoke
```

### 停損條件

- 官方來源需要未取得的權限：保留 source card 與失敗證據，不用假資料冒充 live integration。
- 來源沒有穩定 ID、時間或幾何：先停在 Raw／source registry，不送入 curated package。
- 來源資料不能可靠判定內湖範圍：保留 Raw，curated 結果標記為 validation failure，不使用粗略文字猜測。
- 靜態圖層若無法支持 Peer Sync：先交付離線 layer package，不修改既有 event sync 契約。
- 任一資料無法通過 hash／signature／version／TTL 驗證：不交給 B 或 C 作為目前有效資料。

## 12. Plan self-review

- `system.md` 的真實資料源接入：Task 1、3、4、5、8。
- `system.md` 的 100–1,000 筆 fixture：Task 7。
- `system.md` 的 hash、Ed25519、Manifest、Chunk：Task 3、5、7。
- OSSInt 的 10 類資料盤點：Task 1、6、8；GNSS 已明確改為 Android local input。
- 靜態與動態資料分層：Task 1、5、6。
- Raw、provenance、TTL、namespace、版本倒退與缺值規則：Global Constraints、Task 2、3、4、7。
- 現有事件 pipeline 相容性：Task 3、5、7 的既有測試與 CLI 驗收。
- 未納入本 plan 的工作：Android GIS、GNSS 實作、Peer Sync、資料分析與實驗量測；它們分別由 B、C、D 負責。
