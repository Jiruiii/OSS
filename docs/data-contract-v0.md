# ResilientGeo Mesh v0 資料契約

這一版先固定資料邊界，讓 pipeline、Android 儲存層與 peer sync 可以各自開發。所有時間使用 RFC 3339 UTC；GeoJSON 座標使用 `[longitude, latitude]`。

## 身分與版本

事件的邏輯鍵是 `(namespace, event_id)`，不是單獨的 `event_id`。因此 `official.tdx/road:382` 與 `crowd.community/road:382` 可以同時存在，群眾回報不會覆蓋官方事件。

`event_version` 是同一邏輯鍵的單調遞增版本。`source_version` 保留原始資料源的版本字串，不能拿來取代 `event_version` 的比較。

## 完整性與簽章

`payload_hash` 是下列欄位組成的 canonical JSON（鍵名以 UTF-8 位元組排序、無空白）的 SHA-256：

```text
namespace, event_id, event_type, geometry, severity, source,
source_version, event_version, issued_at, expires_at, attributes
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

本目錄的 fixture 使用穩定的測試 hash／signature token，供 schema 與狀態轉移測試使用；它們不是正式信任根。正式 pipeline 接上 Ed25519 後，必須以實際 hash 與簽章取代。

## 套用順序

接收端依序執行：

1. 解析 schema；格式錯誤直接拒絕。
2. 驗證 manifest／chunk hash，再驗證每個 Event 的 payload hash 與 Ed25519 signature。
3. 以 `(namespace, event_id)` 查詢本機版本；較舊或相同版本不覆蓋目前事件。
4. 較新版本以原子交易寫入，並保留接收與傳輸 provenance。
5. 顯示時以 `evaluation_time >= expires_at` 判定 expired；過期資料可留在 cache，但不能標示為目前有效。

`fixtures/expected-results-v0.json` 是上述規則的可重播預期結果。
