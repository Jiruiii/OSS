# 全台真實資料提供與 Flutter Demo 整合指南

本文件說明如何把官方全台資料收集、整理成 Flutter Demo 可讀取的資料，並讓其他開發者可以透過 HTTP 取得 Demo 使用的 JSON。

## 先看結論

目前專案有兩種資料流：

1. `pipeline/` 由伺服器或本機呼叫 NCDR、CWA、TDX、避難所、醫療與 OSM 官方來源。
2. Flutter Web Demo 不直接呼叫這些官方 API，而是讀取已經產生的 JSON asset。

目前 repository **沒有已部署的公開 REST API server**。因此：

- 要測試或分享 Demo：把 Flutter build 產物放到 HTTP server，其他人可以讀取其中的 JSON asset。
- 要提供正式的即時資料 API：需要另外部署一個後端或靜態資料服務，讓它發布 pipeline 產生的「已審查資料」，再把 Flutter loader 改成讀取該 URL。
- NCDR、CWA、TDX 的 API key 與 client secret 只能放在 pipeline 伺服器，不能放進 Flutter Web、Android asset、Raw snapshot 或瀏覽器 JavaScript。

## 目前資料流

```text
官方資料來源
  │  NCDR / CWA / TDX / 避難所 / 醫療 / OSM
  ▼
pipeline/cli.mjs collect
  │
  ├─ Raw snapshot                 內部稽核，不直接公開
  ├─ 正規化 event / feature       統一資料格式
  ├─ collection-metadata.json     成功、部分成功或認證失敗狀態
  └─ 簽章 bundle                  Android 驗證使用
        │
        ├─ export-map
        │    └─ flutter/assets/data/taiwan/static-features.json
        │
        └─ export-flutter-ncdr-demo
             └─ flutter/assets/data/taiwan/ncdr-hazard-events.json
                                      │
                                      ▼
                         Flutter Web Demo / Chrome
```

Flutter 目前使用的兩個 Demo 資料檔如下：

| 檔案 | schema | 內容 | 目前用途 |
|---|---|---|---|
| `flutter/assets/data/taiwan/static-features.json` | `offline-map-display-v1` | 全台避難所、醫療機構及其他已匯出的地圖地物 | 顯示地圖 marker、搜尋與設施資訊 |
| `flutter/assets/data/taiwan/ncdr-hazard-events.json` | `event-batch-v0` | NCDR 正規化事件 | Chrome Demo 顯示目前且具行動價值的示警 |

Android host 若有可用的 native bridge，會以通過簽章驗證並寫入 Room 的資料為準；Chrome 沒有 Android bridge 時，才使用上面的 Flutter asset fallback。

## 1. 準備環境與秘密設定

在 repository 根目錄執行：

```bash
cd /Users/ray/Desktop/OSS
if [ ! -f pipeline/.env ]; then cp pipeline/.env.example pipeline/.env; fi
```

`pipeline/.env` 只放在本機或伺服器，不能 commit：

```dotenv
# NCDR：已有 key 時填入
NCDR_ALERT_API_KEY=
NCDR_ALERT_ENDPOINT=https://alerts.ncdr.nat.gov.tw/api/datastore
NCDR_ALERT_DETAIL_ENDPOINT=https://alerts.ncdr.nat.gov.tw/api/dump/datastore
NCDR_AUTH_MODE=query

# CWA：若要收集 CWA 資料才需要
CWA_API_KEY=

# TDX：若要收集道路事件才需要
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=
TDX_API_ENDPOINTS=

# 全台行政區索引
DATA_SCOPE=taiwan
TAIWAN_BOUNDARY_PATH=/Users/ray/Desktop/OSS/data/area-catalog.json
```

需要注意：

- `TDX_API_ENDPOINTS=` 留白代表使用 pipeline 內建的全台縣市端點清單；不是代表停用全台收集。
- `NCDR_DETAIL_CONCURRENCY=1` 可以降低一次取得大量 CAP 詳細內容時觸發限制的機率。
- 正式服務應使用 secret manager 或伺服器環境變數，不要把 `.env` 上傳給前端或放入 Docker image 的公開層。

## 2. 建立全台行政區索引

先把官方縣市界線與鄉鎮市區界線轉成 EPSG:4326 GeoJSON，再建立 `AreaCatalog`：

`data/area-catalog.json` 是由界線資料產生的本機衍生檔，已加入 `.gitignore`，不應提交到 Git。每位開發者第一次使用全台 pipeline 時，都要在自己的環境執行下面指令產生；只要 `data/boundaries/geojson/` 的兩個輸入檔存在，就不需要從其他人複製這個 137 MB 的檔案。

```bash
node pipeline/cli.mjs area-catalog \
  --input data/boundaries/geojson/county.geojson,data/boundaries/geojson/town.geojson \
  --out data/area-catalog.json
```

若檔名或路徑不同，替換 `--input` 的兩個檔案即可。確認輸出：

```bash
node -e '
const fs = require("node:fs");
const x = JSON.parse(fs.readFileSync("data/area-catalog.json", "utf8"));
console.log({ schema: x.schema_version, coverage: x.coverage, area_count: x.area_count });
'
```

預期 `coverage` 為 `TW`，且 `area_count` 大於 0。

確認 Git 沒有追蹤這個衍生檔：

```bash
git check-ignore -v data/area-catalog.json
```

應該會顯示 `.gitignore` 中的 `/data/area-catalog.json` 規則。不要執行 `git add data/area-catalog.json`；需要提交的是界線來源或產生指令，不是產生後的完整 catalog。

## 3. 收集全台真實資料

建立一次資料快照目錄：

```bash
BOUNDARY="$PWD/data/area-catalog.json"
RUN_ROOT="$PWD/data/live/taiwan/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_ROOT"
```

### 3.1 NCDR 即時示警

這是目前 Flutter Web Demo 會使用的動態資料來源：

```bash
NCDR_DETAIL_CONCURRENCY=1 \
node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source ncdr-hazard-events \
  --out-dir "$RUN_ROOT/ncdr-hazard-events"
```

成功時會產生：

```text
$RUN_ROOT/ncdr-hazard-events/ncdr-hazard-events.raw.json
$RUN_ROOT/ncdr-hazard-events/ncdr-hazard-events.events.json
$RUN_ROOT/ncdr-hazard-events/collection-metadata.json
```

發布前先確認來源狀態：

```bash
node -e '
const fs = require("node:fs");
const p = process.argv[1];
const x = JSON.parse(fs.readFileSync(`${p}/collection-metadata.json`, "utf8"));
console.log({ source_id: x.source_id, source_status: x.source_status, retrieved_at: x.retrieved_at });
if (x.source_status !== "ok") process.exit(2);
' "$RUN_ROOT/ncdr-hazard-events"
```

`blocked_by_auth`、`partial` 或 `stale` 不應該被當成完整成功資料發布。`partial` 可以留作內部診斷，但對外應明確標示資料不完整。

### 3.2 避難所、OSM 與醫療機構

先收集避難所與 OSM，再用 OSM 座標比對醫療機構：

```bash
node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source taiwan-shelter \
  --out-dir "$RUN_ROOT/taiwan-shelter"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source taiwan-shelter-status \
  --out-dir "$RUN_ROOT/taiwan-shelter-status"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source osm-taiwan \
  --out-dir "$RUN_ROOT/osm-taiwan"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source taiwan-medical \
  --coordinate-input "$RUN_ROOT/osm-taiwan/osm-taiwan.features.json" \
  --out-dir "$RUN_ROOT/taiwan-medical"
```

如果全台 Overpass 查詢回傳 `504`，不要把錯誤結果當成空資料。可以將 hospital、clinic、shelter 查詢拆開收集，再合併三個 `features.json` 後，才執行 `taiwan-medical` 的座標比對。完整 source 與錯誤狀態仍保留在各自的 `collection-metadata.json`。

### 3.3 CWA 與 TDX（目前 pipeline 可收集，尚未直接接入 Chrome Demo）

```bash
node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source cwa-earthquake \
  --out-dir "$RUN_ROOT/cwa-earthquake"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source cwa-weather-warning \
  --out-dir "$RUN_ROOT/cwa-warning"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source cwa-typhoon-warning \
  --out-dir "$RUN_ROOT/cwa-typhoon"

node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --scope taiwan \
  --boundary "$BOUNDARY" \
  --source tdx-road-events \
  --out-dir "$RUN_ROOT/tdx-road-events"
```

TDX 全台端點可能因帳戶配額或服務限流回傳 `429`。請查看 `collection-metadata.json` 的 `source_status` 與 Raw snapshot 的端點結果；不要只看總 `event_count` 就宣稱全台成功。

## 4. 匯出 Flutter Demo 資料

### 4.1 匯出全台地圖地物

`export-map` 會移除 pipeline 內部欄位，只輸出前端需要的地圖欄位：

```bash
node pipeline/cli.mjs export-map \
  --input "$RUN_ROOT/taiwan-shelter/taiwan-shelter.features.json,$RUN_ROOT/taiwan-medical/taiwan-medical.features.json,$RUN_ROOT/osm-taiwan/osm-taiwan.features.json" \
  --out flutter/assets/data/taiwan/static-features.json \
  --dataset-id resilientgeo-taiwan \
  --coverage TW
```

輸出格式為：

```json
{
  "schema_version": "offline-map-display-v1",
  "dataset_id": "resilientgeo-taiwan",
  "coverage": "TW",
  "snapshot_at": "...",
  "bounds": [121.0, 21.0, 122.5, 25.5],
  "features": [
    {
      "id": "...",
      "kind": "shelter|medical|poi",
      "geometry": { "type": "Point", "coordinates": [121.5, 25.0] },
      "name": "...",
      "address": "..."
    }
  ]
}
```

### 4.2 匯出 NCDR Demo 示警

這個步驟會把正規化事件投影成 Flutter Demo 可以讀取的代表點，並保留 `operational_relevance` 與 `map_visible`：

```bash
node pipeline/tools/export-flutter-ncdr-demo.mjs \
  --input "$RUN_ROOT/ncdr-hazard-events/ncdr-hazard-events.events.json" \
  --metadata "$RUN_ROOT/ncdr-hazard-events/collection-metadata.json" \
  --out flutter/assets/data/taiwan/ncdr-hazard-events.json
```

NCDR 示警在 Demo 中會依下列條件處理：

- 過期事件不顯示在地圖上。
- `EVACUATION`、`ROUTE_CHANGE`、`HIGH_IMPACT` 類型才是地圖主要操作資訊。
- `BACKGROUND` 類型會保留在資料中，但不直接顯示成地圖 marker。
- 缺少可靠分類時採 fail-closed，不把一般行政通知誤當成緊急事件。

這個匯出檔不是官方 Raw snapshot，也不是 Android 的簽章 bundle；它是給 Flutter Web Demo 使用的顯示投影。

## 5. 在 Flutter Demo 顯示

兩個檔案已在 `flutter/pubspec.yaml` 註冊：

```yaml
assets:
  - assets/data/taiwan/static-features.json
  - assets/data/taiwan/ncdr-hazard-events.json
```

更新檔案後重新啟動 Flutter：

```bash
cd /Users/ray/Desktop/OSS/flutter
/Users/ray/Development/flutter/bin/flutter pub get
/Users/ray/Development/flutter/bin/flutter run -d chrome \
  --no-web-resources-cdn \
  --web-port 8787
```

如果之前已經開著 Demo，建議完整停止後重新執行，不要只依賴 hot restart，避免瀏覽器仍使用舊的 asset bundle。

## 6. 讓其他人透過 HTTP 取得 Demo 資料

### 6.1 本機或同網路 Demo 分享

先建立 release Web build：

```bash
cd /Users/ray/Desktop/OSS/flutter
/Users/ray/Development/flutter/bin/flutter build web --release \
  --no-web-resources-cdn
```

再以靜態 HTTP server 提供：

```bash
python3 -m http.server 8788 \
  --bind 0.0.0.0 \
  --directory build/web
```

瀏覽器 Demo：

```text
http://<這台電腦的 IP>:8788
```

其他程式可以讀取 Flutter build 內的 asset：

```bash
curl -fsS \
  http://127.0.0.1:8788/assets/assets/data/taiwan/static-features.json \
  | jq '{schema_version, dataset_id, coverage, feature_count: (.features | length)}'

curl -fsS \
  http://127.0.0.1:8788/assets/assets/data/taiwan/ncdr-hazard-events.json \
  | jq '{schema_version, source_id, source_status, event_count: (.events | length)}'
```

Flutter asset 的 URL 會是 `/assets/assets/...`，因為 Flutter asset 在 Web build 中還有一層 `assets/` 根目錄。這是目前 Demo 可用的分享方式；它不是長期穩定的公開 API contract。

### 6.2 其他前端呼叫範例

```javascript
const baseUrl = 'https://demo.example.com/assets/assets/data/taiwan';

const [featureResponse, eventResponse] = await Promise.all([
  fetch(`${baseUrl}/static-features.json`),
  fetch(`${baseUrl}/ncdr-hazard-events.json`),
]);

if (!featureResponse.ok || !eventResponse.ok) {
  throw new Error('Taiwan demo data is unavailable');
}

const featureBatch = await featureResponse.json();
const eventBatch = await eventResponse.json();
const now = Date.now();

const currentEvents = eventBatch.events.filter((event) => {
  const expiresAt = event.expires_at ? Date.parse(event.expires_at) : Infinity;
  return expiresAt > now && event.attributes?.map_visible !== false;
});

const shelters = featureBatch.features.filter(
  (feature) => feature.kind === 'shelter',
);
const medicalFacilities = featureBatch.features.filter(
  (feature) => feature.kind === 'medical',
);

console.log({ currentEvents, shelters, medicalFacilities });
```

公開 Demo 建議至少啟用 HTTPS、gzip／Brotli、`ETag` 與適當的 `Cache-Control`。資料檔不應包含 API key、client secret、私鑰或完整未審查的 Raw source record。

## 7. 正式 API 的建議介面

如果需求是讓其他系統長期以穩定 URL 取得資料，建議新增一個後端資料服務或 object storage 靜態發布層。它應該發布 pipeline 已驗證的輸出，而不是讓瀏覽器直接呼叫官方資料源。

建議介面：

| Method | URL | 回應 |
|---|---|---|
| `GET` | `/v1/taiwan/map-features` | `offline-map-display-v1`，全台避難所與醫療等地物 |
| `GET` | `/v1/taiwan/events?source=ncdr&status=current` | `event-batch-v0` 或事件陣列 |
| `GET` | `/v1/taiwan/metadata` | snapshot 時間、來源狀態、資料版本、coverage |
| `GET` | `/v1/taiwan/manifest` | Android 使用的簽章 manifest，不包含私鑰 |

正式服務必須做到：

1. pipeline 先確認 `source_status`，再發布 snapshot。
2. API 回傳 `coverage=TW`、`retrieved_at`、資料版本與來源狀態。
3. `blocked_by_auth`、`partial`、`stale` 要讓呼叫端看得到，不能靜默轉成成功。
4. 動態事件依 `expires_at` 或 Android 的 `apply_state` 過濾，不能把過期事件標成目前事件。
5. Raw snapshot 與認證 header 不直接公開。
6. 後端保存 private signing key；App 和第三方只需要 public key 或已簽章資料。
7. 加上 HTTPS、CORS allowlist、ETag、Cache-Control、速率限制與健康檢查。

目前 Flutter Web 仍是 asset loader，因此若正式 API 上線，還需要新增一個可注入的 remote loader，例如：

```dart
typedef RemoteJsonLoader = Future<String> Function(Uri uri);
```

Web 可以使用 remote loader；Android 仍應以已驗證的 Room／bridge 為權威資料來源。不要讓 Android 或 Web client 直接攜帶 NCDR、CWA、TDX 的認證資訊。

## 8. 發布前檢查清單

- [ ] `area-catalog.json` 的 `coverage` 是 `TW`。
- [ ] `data/area-catalog.json` 只存在於本機，不被 Git 追蹤；每位開發者已自行執行 `area-catalog` 指令產生。
- [ ] NCDR `collection-metadata.json` 是 `source_status=ok`。
- [ ] TDX 若宣稱全台成功，所有內建端點都沒有 `429` 或其他失敗。
- [ ] static features 中沒有只屬於 Neihu 的過濾邏輯。
- [ ] `static-features.json` 至少包含 `shelter` 與 `medical` kind。
- [ ] NCDR Demo asset 的 `source_id` 是 `ncdr-hazard-events`。
- [ ] 瀏覽器能取得 `/assets/assets/data/taiwan/*.json`，沒有 404。
- [ ] Flutter 地圖能顯示台北、花蓮、高雄等不同區域資料。
- [ ] 沒有 API key、client secret、private key 出現在 `flutter/assets`、`build/web`、Raw、log 或 git diff。
- [ ] 對外文件清楚標示資料的 `retrieved_at`，讓使用者知道它不是每次畫面開啟都即時查詢官方 API。

## 9. 常見錯誤

### `404 assets/assets/data/taiwan/static-features.json`

通常是以下其中一項：

- 沒有從 `flutter/` 目錄執行 Flutter 指令。
- 新檔案沒有加入 `flutter/pubspec.yaml` 的 `assets`。
- 修改 asset 後只做 hot restart，沒有完整重新 build。
- HTTP server 的根目錄不是 `flutter/build/web`。

### Demo 有地圖但沒有全台醫療或避難所

檢查 `static-features.json` 的 `features` 是否包含 `kind=shelter` 與 `kind=medical`，以及 `export-map --input` 是否真的包含對應的兩個 normalized feature files。

### NCDR 有資料但地圖只出現少數事件

這是預期行為：Flutter Demo 只顯示未過期且 `map_visible=true` 的 NCDR 事件；一般行政通知、消防檢查等 `BACKGROUND` 資料仍可能保留在 JSON，但不會畫成逃生／改道路線用 marker。

### TDX 收集結果是 `partial`

這通常表示某些縣市端點回傳 `429` 限流或其他 HTTP 錯誤。查看 Raw snapshot 的 `payload.sources`，等配額恢復後重試；在未確認所有端點成功前，不要宣稱取得完整全台道路事件。
