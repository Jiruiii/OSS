# ResilientGeo Mesh v0 資料契約

這一版先固定資料邊界，讓 pipeline、Android 儲存層與 peer sync 可以各自開發。所有時間使用 RFC 3339 UTC；GeoJSON 座標使用 WGS84 `[longitude, latitude]`，缺值使用 JSON `null`，不以 `0` 代替。

## 資料產品邊界

| 資料產品 | 契約 | 用途 | 例子 |
| --- | --- | --- | --- |
| Dynamic Event | `event-v0`、`manifest-v0`、`chunk-v0` | 有發生時間、版本與 TTL 的動態狀態 | 道路封閉、地震、天氣警報、避難所開設狀態 |
| Static Feature | `feature-v0`、`layer-manifest-v0`、`layer-chunk-v0` | 可放在離線地圖上的靜態向量物件 | OSM 道路、避難所位置、醫院、災害潛勢區 |
| Static Raster | artifact metadata（後續版本定義） | 大型格網或影像檔 | DEM／DSM、SAR、光學影像 |
| Device Local Context | 不進共享資料封包 | Android 裝置本機即時資料 | GNSS／GPS 使用者位置 |

GNSS／GPS 不建立外部 Collector，不進入 Raw snapshot、Event、Feature 或 Peer Sync 封包。靜態 Feature 也不能為了沿用既有程式而假裝成 Event。

## 身分與版本

事件的邏輯鍵是 `(namespace, event_id)`，不是單獨的 `event_id`。因此 `official.tdx/road:382` 與 `crowd.community/road:382` 可以同時存在，群眾回報不會覆蓋官方事件。

`event_version` 是同一邏輯鍵的單調遞增版本。`source_version` 保留原始資料源的版本字串，不能拿來取代 `event_version` 的比較。

靜態 Feature 的邏輯鍵是 `(namespace, layer_id, feature_id)`。`dataset_id` 表示所屬資料集，`layer_id` 表示圖層，例如 `shelter`、`medical` 或 `osm-road`。來源特有欄位保存在 `properties`，不能提升成每個來源都必須實作的共同欄位。

Feature 的單筆來源版本保存在 `source_version`；整個靜態 layer 的單調版本保存在 Layer Manifest 的 `dataset_version`。收到較舊的 layer 版本時，不得覆蓋較新的本機版本。

## 完整性與簽章

`payload_hash` 是下列欄位組成的 canonical JSON（鍵名以 UTF-8 位元組排序、無空白）的 SHA-256：

```text
namespace, event_id, event_type, geometry, severity, source,
source_version, event_version, issued_at, expires_at, attributes
```

Feature 的 `payload_hash` 使用相同 canonical JSON 規則，覆蓋以下欄位：

```text
namespace, dataset_id, layer_id, feature_id, feature_type, geometry,
properties, source, source_version, issued_at, expires_at
```

簽章覆蓋 canonical payload 加上 `payload_hash`。v0 固定使用 Ed25519；私鑰只存在 pipeline／伺服器，不進 Android App。

Chunk 的 `chunk_hash` 覆蓋 canonical chunk content（dataset metadata、priority、encoding 與 events），不包含 `manifest_id`、`manifest_hash`、`byte_length` 與 signature envelope，避免 manifest hash 與 chunk hash 互相循環。Chunk signature 再覆蓋完整的 binding envelope；Manifest signature 覆蓋含 `manifest_hash` 但不含自身 signature 的內容。

`provenance.original_source`、`provenance.received_at` 與 `provenance.transport_source` 是傳播稽核資料，不參與 payload hash，也不能被 peer 改寫成原始來源。

## 地區與主題（area_id / theme）

每筆事件用 `attributes.area_id`（生活圈，例 `neihu.donghu`）與 `attributes.theme`（`road`、`shelter`、`flood`、`landslide`、`medical`、`transit`）標記它屬於哪個地理與主題切片。這兩個欄位刻意放在 `attributes` 內，理由是：

1. `attributes` 已在簽章的 canonical payload 內（`payload_hash` 涵蓋範圍），所以來源一旦簽了，就不能被 peer 改動 area/theme 而不被偵測。
2. `event-v0.schema.json` 的 `attributes` 是 `additionalProperties: true`，不必動 schema。

**Chunk 與 manifest 另外顯式帶一份 `area_id`／`theme`／`bbox`**（兩份 schema 為此新增必填欄位）：

- `chunk_hash` 的 canonical content 納入 `area_id`、`theme`、`bbox`，所以竄改分片宣稱的區域會讓 chunk hash 對不上。
- `manifest.chunks[]` 每個條目也帶這三欄，讓節點**不下載 chunk 就能判斷該片是否與自己所在區域相交**。
- `bbox` 一律 `[minLon, minLat, maxLon, maxLat]`，由分片內所有事件幾何推導（不手填）。接收端 `verifyChunk()` 會重算並比對，不符時回 `stage: 'integrity'`、`chunk_bbox_mismatch`。

事件層的 `area_id` 隨事件簽章移動；chunk 層的 `area_id` 隨 chunk hash 固定——兩者都不可由中繼節點改寫。

`issued_at` 是來源資料或 snapshot 的發布時間；`expires_at` 是接收端應停止把該資料視為目前版本的時間。靜態資料沒有官方失效時間時，由 source catalog 的 `ttl_policy` 決定更新期限，不能假裝成即時 API。

本目錄的 fixture 使用穩定的測試 hash／signature token，供 schema 與狀態轉移測試使用；它們不是正式信任根。正式 pipeline 接上 Ed25519 後，必須以實際 hash 與簽章取代。

## 套用順序

接收端依序執行：

1. 解析 schema；格式錯誤直接拒絕。
2. 驗證 manifest／chunk hash，再驗證每個 Event 的 payload hash 與 Ed25519 signature。
3. 以 `(namespace, event_id)` 查詢本機版本；較舊或相同版本不覆蓋目前事件。
4. 較新版本以原子交易寫入，並保留接收與傳輸 provenance。
5. 顯示時以 `evaluation_time >= expires_at` 判定 expired；過期資料可留在 cache，但不能標示為目前有效。

`fixtures/expected-results-v0.json` 是上述規則的可重播預期結果。

## 靜態 Layer 封包

`layer-manifest-v0` 是一個靜態向量圖層版本的簽章索引，至少包含：

- `dataset_id`、`layer_id`、`namespace` 與 `dataset_version`。
- `source`、`source_version`、`created_at` 與 `expires_at`。
- `total_feature_count`、`total_size_bytes` 與 chunk 清單。
- Manifest hash、Ed25519 signature 與 `signing_key_id`。

`layer-chunk-v0` 是實際傳輸單位，使用 `features` 裝載 `feature-v0`，不能使用動態事件 Chunk 的 `events` 欄位。每個 chunk 必須綁定已驗證的 Layer Manifest，並驗證 `manifest_hash`、`chunk_hash`、大小、筆數與簽章。

靜態 Layer 的接收順序為：

1. 驗證 Layer Manifest schema、hash、簽章與信任金鑰。
2. 比較 `(namespace, dataset_id, layer_id)` 的本機 `dataset_version`，拒絕版本倒退。
3. 只要求本機缺少的 Layer Chunk。
4. 驗證 Chunk 與 Manifest binding，再驗證每筆 Feature。
5. 全部必要 Chunk 驗證成功後，以原子方式切換到新的 layer 版本。

## Source catalog 與 Raw 的關係

`pipeline/sources/catalog.json` 只登記來源入口、存取模式、授權、更新頻率、座標系統、TTL 與內湖過濾方法，不保存 API key，也不是原始資料快照。

Task 2 才會定義 `raw-snapshot-v0`。Collector 必須先保存未篩選的原始回應，再建立內湖區正規化輸出；Collector 只做取得、保存、區域篩選、欄位正規化與品質驗證，不計算坡度風險、孤立風險、避難指標或路線。
