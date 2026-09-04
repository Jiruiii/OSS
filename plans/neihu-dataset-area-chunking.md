# 內湖 Demo 資料集 ＋ 地理分片

## Context

Demo 場域定在**台北市內湖區**，但目前 repo 的資料集完全對不上：

1. **地理錯誤。** 所有 fixture 座標落在 `121.59–121.62°E, 23.97–24.00°N`（花蓮吉安一帶的台9線），內湖區約在 `121.55–121.65°E, 25.05–25.11°N`，相距約 120 公里。內容（`台9線 CLOSED / debris`）對內湖使用者沒有任何意義。

2. **分片與地理脫鉤。** `pipeline/lib/bundle.mjs` 的 `groupEvents()` 是純按 byte 順序累加切片，chunk 邊界跟「資料在哪、是什麼」無關。而手寫的 `fixtures/manifest-v136.json` 卻假裝切成 road / shelters / weather 三片（且用假 hash），與程式實際行為不符。

3. **Demo 主軸演不出來。** 目前只有 3–4 筆事件、`target_size_bytes` 4096 → `buildBundle` 只會產生**一個 chunk**。「只交換彼此缺少的分片」這個核心敘事，用真實產生的資料無法演示。

4. **缺少相關性概念。** 使用者的原始觀察（住內湖不用知道台9線）一般化後是：西湖的節點不該被迫下載大湖山莊的土石流分片。這正是 `system.md` 第 7 節 **Cellular Savings** 指標的主要來源，但現在資料層沒有任何欄位支撐這個決策。

**預期成果**：一套內湖真實地理的可重播資料集，chunk 依「地區＋主題」切分並帶 bbox，讓 A/B/C 的多機同步 demo 有故事可講、讓 D 的 rarest-first 策略比較有意義，且既有的簽章／驗證／replay 測試全部維持綠燈。

**明確不做**（維持 `system.md` 的定位，避免過度宣稱）：
- 不接 TDX／CWA／NCDR 即時 API。資料源仍是可重播快照。
- 不碰 Android 端。
- 不實作 DIFF/REQUEST 排程器本身（那是 C 的階段 3 工作）。本 branch 只讓**資料層支援**地理過濾，並把規則寫進 `docs/peer-sync-v0.md`。

---

## 決定摘要

| 項目 | 決定 |
|---|---|
| Demo 場域 | 台北市內湖區（報告動機章節仍引用花蓮地震與丹娜絲颱風的斷訊數據） |
| 座標來源 | Overpass API 抓 OSM 真實資料，**存成 repo 內快照**後離線生成 |
| 資料規模 | 三層：契約回歸（小）＋ 策劃 demo（~30）＋ 規模模擬（~500） |
| 分片策略 | 一併導入 `(area_id, theme)` 分組，chunk／manifest 加 `area_id` 與 `bbox` |
| 舊 fixture | 就地改寫為內湖，**保留原有的 5 條規則覆蓋**（更新／新增／crowd namespace／版本倒退／過期） |

Branch 建議：`feat/neihu-dataset-area-chunking`

---

## 一、資料層設計

### 1.1 內湖分區（area_id）

以真實生活圈劃分，作為 chunk 的天然邊界：

| `area_id` | 涵蓋 | 主要災害情境 |
|---|---|---|
| `neihu.xihu` | 西湖捷運站、內湖路一段、德明科大 | 基隆河沿岸淹水 |
| `neihu.tech-park` | 瑞光路、洲子街、港墘（內湖科技園區） | 高日間人口、疏散壅塞 |
| `neihu.wende` | 文德路、內湖路二段、碧湖公園 | 邊坡 |
| `neihu.donghu` | 東湖路、康寧路三段、五分、葫洲 | 低窪積水 |
| `neihu.dahu` | 大湖公園、成功路四段、大湖山莊街 | 山坡地土石流 |

bbox 一律由該區實際事件幾何計算得出，**不手填**。內湖區整體 bbox 於實作時從 OSM 行政區界（`boundary=administrative`）取得，不使用估算值。

### 1.2 主題（theme）與 event_type

| theme | event_type | 資料內容 |
|---|---|---|
| `road` | `ROAD_STATUS` | 成功路、內湖路、康寧路、環東大道、麥帥二橋、民權大橋 |
| `shelter` | `SHELTER_STATUS` | 學校型避難收容處所（容量、開設狀態） |
| `flood` | `FLOOD_WARNING` | 基隆河沿岸、潭美、新明路低窪 |
| `landslide` | `LANDSLIDE_RISK` | 大湖山莊街、金龍路、康樂街山坡地 |
| `medical` | `MEDICAL_FACILITY` | 三軍總醫院內湖院區、康寧醫院 |
| `transit` | `TRANSIT_STATUS` | 文湖線各站 |

皆符合 `event-v0.schema.json` 的 `event_type` pattern `^[A-Z][A-Z0-9_]{2,63}$`。

### 1.3 欄位落點

**Event：零 schema 變更。** `area_id` 與 `theme` 放進 `attributes`：

```json
"attributes": { "area_id": "neihu.donghu", "theme": "shelter", "status": "OPEN", "capacity": 480 }
```

理由：`attributes` 已在 `pipeline/lib/canonical.mjs:41-53` 的 `EVENT_PAYLOAD_FIELDS` 內，自動納入 `payload_hash` 與簽章；`event-v0.schema.json` 的 `attributes` 是 `additionalProperties: true`。不必動 schema，不影響既有簽章邏輯。

**Chunk／Manifest：需顯式加欄位**（兩份 schema 都是 `additionalProperties: false`）：

- `schemas/chunk-v0.schema.json`：新增 `area_id`（pattern 比照 namespace：`^[a-z][a-z0-9._-]{0,63}$`）、`theme`、`bbox`（本地 `$defs/bbox`，比照 `event-v0.schema.json:373`）。三者列入 `required`。
- `schemas/manifest-v0.schema.json`：`chunks[]` 條目新增同樣三欄，讓節點**不下載 chunk 就能判斷是否與自己所在區域相交**。

**`area_id` 與 `bbox` 必須進 chunk_hash。** 修改 `pipeline/lib/canonical.mjs` 的 `chunkContent()` 納入這三欄，否則 peer 可以竄改分片宣稱的區域而不被偵測。`bbox` 由事件幾何推導，接收端可重算驗證。

### 1.4 三層 fixture（用途必須在 README 寫清楚，避免組員混淆）

| 路徑 | 筆數 | 用途 |
|---|---|---|
| `fixtures/events-batch-1.json`、`-2.json`、`expected-results-v0.json` | 4 | **契約回歸**。就地改為內湖地物，維持原有 5 條規則覆蓋。Python replay 測試用，刻意保持小而穩定 |
| `fixtures/neihu/demo-v136.json`、`demo-v137.json` | ~30 | **Demo 敘事**。真實內湖地物，橫跨 5 個 area、6 個 theme。給 A/B/C 演示與 Android UI |
| `fixtures/neihu/scale-v136.json` | ~500 | **規模與模擬**。從 OSM 快照生成，補上 `system.md` 階段 0 缺的「100–1,000 筆測試事件與更新序列」，給 D 的模擬與多 chunk 分片測試 |

---

## 二、程式變更

### 2.1 `pipeline/lib/normalize.mjs` — 一般化（目前有兩個實際缺陷）

- **`normalize.mjs:29`**：`event_id` fallback 硬編成 `road:${record.id}`，多主題資料集會產生 `road:shelter-01` 這種錯誤 id。改為依 `theme`／`event_type` 決定前綴。
- **`normalize.mjs:18`**：硬性拒絕 `source !== 'TDX'`。內湖資料集有 TDX／CWA／NCDR／消防署／OSM 多來源。改為 `normalizeSource(raw, options)`，接受允許來源清單，`normalizeTdx` 保留為薄包裝以維持既有呼叫端與測試不變。
- 從 record 讀取 `area_id`／`theme` 並寫入 `attributes`；兩者缺一即拋錯（不給預設值，避免靜默錯分片）。

### 2.2 `pipeline/lib/bundle.mjs` — 分片分組（核心變更，約 20–30 行）

`groupEvents()` 改為兩階段：

1. 依 `(attributes.area_id, attributes.theme)` 分桶，桶的順序以 `area_id` → `theme` 穩定排序（**可重播性的前提**）。
2. 桶內若超過 `targetSizeBytes`，沿用現有的累加切法切成多片。

`chunk_id` 改為 `${datasetId}:chunk:${datasetVersion}:${areaShort}:${theme}:${seq}`，例：`resilientgeo-demo:chunk:136:donghu:shelter:000`。符合 chunk_id 的 `^[a-z0-9][a-z0-9._:-]{0,255}$` pattern。

新增 `bboxOf(events)` 工具，回傳 `[minLon, minLat, maxLon, maxLat]`，需處理 Point／LineString／Polygon／Multi\* 與 GeometryCollection（`event-v0.schema.json` 全部允許）。

`manifest.chunks[]` 條目同步帶上 `area_id`、`theme`、`bbox`。

### 2.3 `pipeline/lib/canonical.mjs`

`chunkContent()` 加入 `area_id`、`theme`、`bbox`。既有 chunk hash 會全部改變，但**不會弄壞任何測試**——chunk hash 都是 `buildBundle` 現場計算後立即驗證，repo 內沒有寫死的期望 hash。

### 2.4 `pipeline/lib/contract.mjs`

`validateChunkShape()` 補上三個新欄位的檢查；`verifyChunk()` 增加一項：重算 bbox 並與宣稱值比對，不符時回 `stage: 'integrity'`、`errors: ['chunk_bbox_mismatch']`。

### 2.5 新增 `tools/fetch-osm-neihu.mjs`（一次性，結果進 git）

Overpass API 查詢內湖區行政區界內的：主要道路（`highway=primary|secondary|tertiary`）、學校（`amenity=school`）、醫院（`amenity=hospital`）、水系（`waterway=river`）、捷運站（`station=subway`）。

**輸出寫成 `fixtures/neihu/osm-snapshot.json` 並提交進 repo。** 之後所有 fixture 生成都讀快照，不再打 API——這是「可重播」的硬性要求，也避免 Overpass rate limit 與資料漂移。快照需記錄抓取時間與查詢語句。

### 2.6 新增 `tools/generate-neihu-fixtures.mjs`

吃 `osm-snapshot.json` ＋ 一份情境設定檔（`fixtures/neihu/scenario.json`：災害腳本、時間軸、area 對應），輸出 curated 與 scale 兩套 fixture。**固定 seed**，同 seed 產生位元相同的輸出。

### 2.7 文件

- `docs/peer-sync-v0.md`：新增一節說明 bbox 相關性過濾規則——節點可只 REQUEST 與自身所在／鄰接 area 相交的分片，並註明排程器實作屬階段 3。
- `docs/data-contract-v0.md`：說明 `area_id`／`theme` 落在 `attributes`（隨事件簽章）與 chunk 層（隨 chunk hash）的雙重位置及理由。
- `fixtures/README.md`：三層 fixture 的用途、內湖 area 定義、OSM 快照的抓取方式與時間。
- `pipeline/README.md`：更新 CLI 範例為內湖資料集。
- `system.md`：更新進度總覽——階段 0「100–1,000 筆測試事件」可標記完成；補上 demo 場域為內湖區。

---

## 三、實作順序（建議 commit 切法）

1. **抓 OSM 快照** — `tools/fetch-osm-neihu.mjs` ＋ `fixtures/neihu/osm-snapshot.json`。獨立一個 commit，之後不再需要網路。
2. **schema 加欄位** — chunk-v0、manifest-v0 加 `area_id`／`theme`／`bbox`。此時測試仍應全綠（欄位尚未被寫入，但 required 會讓既有 build 失敗 → 與步驟 3 併為同一 commit，或先設為 optional 再於步驟 3 轉 required）。
3. **pipeline 改造** — canonical／bundle／contract／normalize 四檔，加上新測試。
4. **契約回歸 fixture 就地改為內湖** — `events-batch-1/2`、`expected-results-v0`、`tdx-fixture`、`manifest-v136`、兩份 peer summary、`protocol-exchange-v0`；同步更新 `tests/test_replay_fixture.py` 與 `pipeline/test/pipeline.test.mjs` 內的 event_id 斷言（`road:382` → 內湖對應 id）。
5. **生成器與兩套資料集** — `tools/generate-neihu-fixtures.mjs` ＋ curated ＋ scale。
6. **文件更新** — 上述五份文件。

步驟 1–3 可先合併驗證，4–6 再接。

---

## 四、驗證

**既有測試必須全綠（不得放寬）：**

```powershell
npm test                                    # Node 6 項
python -m unittest discover -s tests -v     # Python 4 項
python tools/replay_fixture.py --check      # 應印出 PASS
```

**端到端 CLI（重點是要看到「多個 chunk 且 chunk_id 帶 area」）：**

```powershell
node pipeline/cli.mjs keygen --out-dir .stage2-keys --key-id neihu-demo-2026
node pipeline/cli.mjs build `
  --input fixtures/neihu/demo-v136.json `
  --out-dir .neihu-bundle `
  --private-key .stage2-keys/private-key.pem `
  --key-id neihu-demo-2026
node pipeline/cli.mjs verify `
  --manifest .neihu-bundle/manifest.json `
  --chunks-dir .neihu-bundle/chunks `
  --public-key .stage2-keys/public-key.pem `
  --now 2026-09-01T08:00:00Z
```

驗收條件：
- `build` 輸出 `chunks` 數量 **> 1**（目前是 1，這是本 branch 要解決的核心問題）
- chunk 檔名含 area 與 theme，例如 `resilientgeo-demo_chunk_136_donghu_shelter_000.json`
- `verify` 回 `"valid": true`
- 用 scale 資料集重跑，chunk 數應顯著更多

**新增測試（`pipeline/test/`）：**

1. 同 `(area_id, theme)` 的事件被分到同一片（未超過 size 上限時）
2. 竄改 chunk 的 `area_id` → `verifyChunk` 回 `chunk_hash_mismatch`
3. 竄改 chunk 的 `bbox` → 回 `chunk_bbox_mismatch`
4. 每片 chunk 的 bbox 確實涵蓋該片所有事件幾何
5. scale 資料集產生 > 1 個 chunk（回歸「永遠只有一片」的問題）
6. normalizer 處理多來源、多主題時 `event_id` 前綴正確
7. 生成器同 seed 兩次執行輸出位元相同

---

## 五、風險與注意事項

- **OSM 快照必須進 git。** 若改成執行時打 Overpass，「報告可重現」（`system.md` 階段 4 通過條件）就守不住。
- **不要在 fixture 中編造座標。** 若某個地物在 OSM 快照裡找不到，寧可少一筆，或在 `fixtures/README.md` 明確標註哪些是為 demo 設計的合成災情（合成的是**事件**，不是**地物位置**）。
- **災情事件本身是虛構的。** 真實地物 ＋ 虛構災情的組合必須在 README 與 demo 腳本裡寫明，避免被誤讀為真實災況——這與 `system.md` 一貫的不過度宣稱原則一致。
- **`normalizeTdx` 是既有測試的呼叫入口**（`pipeline/test/pipeline.test.mjs:16,36`）。一般化時保留這個具名匯出，否則 6 項 Node 測試會整批失敗。
- **步驟 4 會改到 `expected-results-v0.json`。** `tools/replay_fixture.py:294` 是整份 `delta_decisions` 陣列比對，事件 id 一改就必須同步更新，不能只改一半。
- **內湖區 bbox 待實作時確認。** 計畫中未寫死數值，一律由 OSM 行政區界與實際事件幾何導出。
