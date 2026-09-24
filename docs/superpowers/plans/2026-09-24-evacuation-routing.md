# 離線逃生路線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 狀態：2026-09-24 規劃，**尚未實作**。任務總覽見 `docs/mvp-remaining-tasks.md` G 段。

**Goal:** 用手機上已經有的資料計算步行逃生路線，完全離線：
- 道路圖來自打包的 OSM 快照。
- 災情來自 Room 裡已驗證的事件，包括道路封閉、淹水範圍、土石流警戒。
- 避難所來自打包的點位，加上避難所狀態事件（開設與否、剩餘容量）。

App 從使用者的位置出發，找出最近、開設中、而且適用於當前災害類型的避難所，避開封閉道路和危險區域；mesh 帶來新事件時自動重算。

**Architecture:** 路線計算是 Flutter 端的純 Dart 模組 `flutter/lib/routing/`，不經過 Android、不需要網路。
- 啟動時在背景 isolate 把 `static-features.json` 的道路建成圖。
- 每次事件更新時，把事件轉成邊的「封鎖／加權」覆蓋層，不重建整張圖。
- 以使用者位置為起點跑一次多目標 Dijkstra，得到到所有避難所的距離，排序後取前 3 名。

路線計算只讀資料。Android 的 Room、驗證與信任邏輯都不動。

**Tech Stack:** Dart（Flutter 3.29.2 / Dart 3.7.2）、`compute()` isolate、現有的 `flutter_map` `PolylineLayer` 與 `google_maps_flutter` `Polyline`、現有的 `LocationGateway`，以及 `flutter test`。不新增任何套件。

## 現有資料盤點（2026-09-24 實際檢查）

| 資料 | 來源 | 規模／狀態 | 路線用途 |
|---|---|---|---|
| 道路 | `flutter/assets/data/neihu/static-features.json`（`kind=road`） | 5,774 條 LineString，約 39k 個頂點、其中 8,120 個被多條路共用（路口可連通）；帶 `road_class` | 建圖 |
| 避難所 | 同上（`kind=shelter`） | 26 處，含 `capacity`、`disaster_types`（如「水災」「震災」） | 目的地 |
| 道路狀態事件 | `ROAD_STATUS`（`official.tdx`），`attributes.status` = OPEN／PARTIAL／CLOSED | 事件 id 內含 OSM way id（`w23766392-…`），10/10 能對上靜態道路的 `osm:way:<id>` | 封鎖或加權 |
| 淹水／土石流 | `FLOOD_WARNING`（Polygon，CRITICAL）、`LANDSLIDE_RISK`（Polygon，HIGH） | demo 資料集中淹水 3 處、土石流 2 處 | 危險區域 |
| 避難所狀態 | `SHELTER_STATUS`（`official.fire`），`status` OPEN／STANDBY，含 `capacity`、`available` | `site_name` 5/5 能以名稱對上靜態避難所；幾何是 Polygon，不是 Point | 過濾與排序目的地 |
| 群眾回報 | `crowd.*`（`UNVERIFIED`），依民眾回報計畫而來 | 還沒有 | 軟性加權，不封鎖 |

**資料缺口（要在計畫內處理或寫進限制）：**
- 靜態道路沒有 `oneway` 和 `access` 等標籤，只有 `road_class`。步行路線影響不大；如果要做車行路線，需要重新擷取 OSM。
- 沒有高程資料，無法判斷「往高處走」。內政部 DTM 目前只登錄了 metadata。
- 避難所狀態和靜態避難所只能靠名稱對應，屬於脆弱的 join，需要加上距離作為備援比對。
- 現有 demo 資料集只有 1 條 CLOSED 道路，封路對路線的影響展示不出來，需要準備 demo 情境。

## Global Constraints

- **全程離線。** 不呼叫任何路線 API（包括 Google Directions），Google 底圖只負責顯示。
- **只用 Android 已經驗證過的事件。** 路線模組只從 bridge 的事件流取資料，不直接讀 fixture。`EXPIRED` 事件不參與計算，但要在畫面上提示「有已過期的封路資訊」。
- **`UNVERIFIED`（群眾回報）只能加權，不能封鎖。** 否則一筆假回報就能把所有人導離最佳路線，這是明顯的濫用途徑。
- **不宣稱是官方疏散指示。** 路線畫面固定顯示「依本機資料推算，僅供參考，請遵從現場人員指示」，並附上所依據資料的最新時間。
- 決定性：同樣的圖、事件和起點，一定得到同樣的路線。距離相同時依 node id 決定順序。這樣測試才穩定，也方便之後在 simulator 裡重用。
- 不修改 Flutter 產生的 `flutter/.android/`。

## 已確認的設計決策

| 項目 | 決定 |
|---|---|
| 交通方式 | 第一版只做**步行**。災時車行容易造成壅塞，而且資料缺 `oneway` 標籤 |
| 計算位置 | Flutter 端純 Dart。靜態資料本來就在 Flutter asset 裡，事件也已經透過 bridge 送到 Flutter；Android 不需要知道路線 |
| 演算法 | 多目標 Dijkstra：從起點跑一次，拿到所有避難所的距離。約 30k 個節點，預期 < 100 ms；超過就改 A\* 並逐一對避難所計算 |
| 可步行道路 | 允許 `footway`／`path`／`pedestrian`／`steps`／`residential`／`living_street`／`service`／`unclassified`／`tertiary`／`secondary`／`track`／`cycleway` 與相應的 `_link`；排除 `motorway`、`trunk` 及其 `_link`、`elevator`、`bus_stop`、`corridor` |

## 待確認（開工前要決定）

- 路線入口：地圖上的「逃生路線」按鈕（使用目前位置），還是也要能長按指定起點。**本計畫先以「兩者都要」撰寫**。
- 災害類型如何決定：從有效的事件自動推斷（有淹水警戒就用「水災」過濾避難所），還是讓使用者自己選。**建議自動推斷，允許手動覆寫。**
- 危險區域的處理方式：CRITICAL 完全封鎖、HIGH 大幅加權（×5），這組參數需要確認。
- 要不要做「起點本身就在危險區內」的提示，例如「你位於淹水警戒區，請盡快離開」。建議要做。

---

### Task 1: 道路圖建構

**Files:**

- Create: `flutter/lib/routing/road_graph.dart`（`RoadGraph`、`GraphNode`、`GraphEdge`）
- Create: `flutter/lib/routing/geo_math.dart`（haversine 距離、點到線段距離、點在多邊形內、線段與多邊形相交）
- Create: `flutter/test/routing/road_graph_test.dart`
- Create: `flutter/test/routing/geo_math_test.dart`
- Create: `flutter/test/fixtures/routing/tiny-grid.json`（手工製作的 3×3 小網格，方便斷言）

**Produces:** `RoadGraph.fromStaticFeatures(StaticFeatureCollection)` 會輸出一張步行道路圖：
- 共用的頂點成為節點，每段相鄰頂點成為雙向邊。
- 每條邊記錄 `osmWayId`、`roadClass` 和長度（公尺）。
- 另外建一個節點空間格網索引，供「最近節點」查詢。

- [ ] **Step 1: 寫 `geo_math` 測試。** 用已知的內湖兩點 haversine 距離驗證計算，容許誤差 0.5%；點在多邊形內要涵蓋邊界與洞；線段與多邊形相交要涵蓋「兩端點都在外但穿過」的情況。
- [ ] **Step 2: 寫 `road_graph` 測試。**
  - 小網格的節點數和邊數正確。
  - 被排除的 `road_class` 不會進圖。
  - 共用頂點會合併成同一個節點。
  - `nearestNode` 找到正確的節點，距離超過 300 m 時回傳 null。
  - 用真實的 `static-features.json` 建圖，最大連通分量要占節點總數的 90% 以上；如果不到，要先查清楚原因，再決定要不要調整門檻。
- [ ] **Step 3: 實作。** 座標 key 取到小數點後 7 位；建圖在 `compute()` isolate 內執行。
- [ ] **Step 4: 量測建圖耗時與記憶體**，寫在測試輸出或文件中。目標是中階手機（Pixel 7a 等級）不超過 1 秒。

### Task 2: 災情覆蓋層（事件轉成邊的封鎖或加權）

**Files:**

- Create: `flutter/lib/routing/hazard_overlay.dart`
- Create: `flutter/test/routing/hazard_overlay_test.dart`

**Produces:** `HazardOverlay.fromEvents(List<MeshEvent>, RoadGraph, DateTime now)` 會算出每條邊的狀態（`blocked`、`penalty` 倍率、`reasons`），並列出 `warnings`（例如「有 2 筆已過期的封路資訊未納入」）。

規則（每條都要有對應測試）：

| 事件 | `apply_state` | 效果 |
|---|---|---|
| `ROAD_STATUS` CLOSED | CURRENT | 對應 `osmWayId` 的所有邊 `blocked` |
| `ROAD_STATUS` PARTIAL | CURRENT | penalty ×3 |
| `FLOOD_WARNING` / 其他 severity=CRITICAL 的 Polygon | CURRENT | 與多邊形相交的邊 `blocked` |
| `LANDSLIDE_RISK` / severity=HIGH 的 Polygon | CURRENT | 相交的邊 penalty ×5 |
| 任何 `crowd.*` | UNVERIFIED | penalty ×2，reason 標明「未驗證回報」，**不封鎖** |
| 任何事件 | EXPIRED | 不參與計算，列入 `warnings` |

- [ ] **Step 1: 寫失敗測試。** 上表每列一個測試，再加上：
  - `ROAD_STATUS` 的 event id 無法對上任何路時，列入 `warnings`，不當成錯誤。
  - 同一條邊同時被多個事件影響時，`blocked` 優先，penalty 取最大值，不做乘積，避免數值暴增。
  - `road_status` 的 way id 解析要支援 `w<id>-<slug>` 和 `road:w<id>-<slug>` 兩種格式。
- [ ] **Step 2: 實作。** 多邊形相交先用 bbox 預過濾。
- [ ] **Step 3: 效能。** 用真實圖與 demo 事件，覆蓋層計算要在 50 ms 內。

### Task 3: 避難所目的地

**Files:**

- Create: `flutter/lib/routing/shelter_targets.dart`
- Create: `flutter/test/routing/shelter_targets_test.dart`

**Produces:** `ShelterTargets.resolve(staticShelters, events, hazardKind, now)` 輸出候選避難所清單，每筆包含位置、名稱、狀態、剩餘容量，以及狀態來自哪筆事件。

- [ ] **Step 1: 寫失敗測試。**
  - `SHELTER_STATUS` 依名稱對上靜態避難所。名稱對不上時，改用「事件多邊形中心點 100 m 內」比對。
  - 狀態 STANDBY 或 CLOSED 的排除。
  - `available == 0` 的排除；`available` 為 null（沒有狀態事件）的保留，但標記「狀態未知」，排序時放在有確認開設的後面。
  - `disaster_types` 不包含目前災害類型的排除。沒有指定災害類型時不過濾。
  - 避難所本身位在 CRITICAL 危險區內的排除。
- [ ] **Step 2: 實作 `hazardKind` 自動推斷。** 有 CURRENT 的 `FLOOD_WARNING` 時用「水災」，有 `LANDSLIDE_RISK` 時用「土石流」，否則為 null。這份對照表要寫在同一個檔案裡，方便檢視。

### Task 4: 路線計算

**Files:**

- Create: `flutter/lib/routing/evacuation_router.dart`
- Create: `flutter/lib/routing/route_result.dart`
- Create: `flutter/test/routing/evacuation_router_test.dart`

**Produces:** `EvacuationRouter.plan(origin, graph, overlay, targets, {maxResults: 3})` 回傳 `RoutePlan`，內容包括：
- 前 N 條路線：折線、距離（公尺）、預估步行時間、目的地、經過的加權路段與原因。
- `status`：`ok`／`originOffGraph`／`originInHazard`／`noReachableShelter`。

- [ ] **Step 1: 寫失敗測試（小網格）。**
  - 沒有事件時走最短路。
  - 最短路被 CLOSED 封鎖時改走次短路，並且在結果中列出避開了哪條路。
  - PARTIAL 加權足以讓次短路勝出的情況。
  - 所有路都被封鎖時回傳 `noReachableShelter`，不回傳空路線假裝成功。
  - 起點在 CRITICAL 區內時：允許走出危險區的第一段（否則永遠無解），但結果標記 `originInHazard`。
  - 距離相同時的決定性：跑 100 次結果都相同。
- [ ] **Step 2: 實作多目標 Dijkstra。**
  - 邊權重為 `length × penalty`，`blocked` 的邊直接跳過。
  - 顯示給使用者的距離用實際長度，不含 penalty。
  - 步行速度 1.0 m/s，並註明是災時保守值。
- [ ] **Step 3: 用真實資料測試。** 取內湖 5 個生活圈各一個起點，對 demo 事件跑一次：要都有結果、耗時 < 200 ms，並把結果存成 golden 檔，避免之後的修改無聲地改變路線。

### Task 5: 狀態管理與事件更新時重算

**Files:**

- Create: `flutter/lib/routing/evacuation_controller.dart`（`ChangeNotifier`）
- Modify: `flutter/lib/app/map_app_controller.dart`（持有 graph 與 controller）
- Create: `flutter/test/routing/evacuation_controller_test.dart`

**Produces:** 使用者開啟路線後，controller 會訂閱事件流和位置更新。事件改變時重算覆蓋層與路線；如果結果變了（例如目的地或路段變了），就發出「路線因新資訊而變更」的通知，並附上原因。

- [ ] **Step 1: 寫失敗測試。**
  - 新進一筆 CLOSED 事件，封住目前路線，應觸發重算並發出變更通知與原因。
  - 事件更新不影響目前路線時，不發通知。
  - 位置移動不到 30 m 時不重算。
  - 關閉路線功能後停止訂閱。
- [ ] **Step 2: 實作。** 重算在 isolate 內執行；新的重算開始時，丟棄還在進行的舊結果。

### Task 6: UI

**Files:**

- Create: `flutter/lib/widgets/evacuation_panel.dart`（底部面板：前 3 名避難所、距離、時間、警告、免責聲明）
- Modify: `flutter/lib/screens/map_screen.dart`（入口按鈕、長按選起點）
- Modify: `flutter/lib/widgets/map_layers.dart`、`flutter/lib/widgets/google_map_layers.dart`（路線折線；被避開的路段用虛線標示）
- Create: `flutter/test/evacuation_panel_test.dart`

**Produces:** 按下「逃生路線」後，地圖畫出最佳路線，面板列出 3 個選項，點選任一個就切換路線；兩種 renderer（Google／OSM 離線）的顯示一致。

- [ ] **Step 1: 寫 widget 測試。**
  - 每種 `status` 都有對應文字；`noReachableShelter` 要建議「聯絡 119 或前往較高樓層」，不能只顯示空白。
  - 免責聲明與資料時間永遠顯示。
  - 路線經過未驗證回報的路段時，顯示「經過未驗證回報路段」。
- [ ] **Step 2: 實作。** 路線顏色要和事件分色（CURRENT／EXPIRED／UNVERIFIED）明顯區分，深色模式也要測。
- [ ] **Step 3: 實機手動驗證。** 開飛航模式後在 OSM 離線底圖上規劃路線；開網路後在 Google 底圖上看到同一條路線。

### Task 7: Demo 情境資料

**Files:**

- Create: `data/fixtures/neihu/evacuation-scenario.json`（合成事件，建立在真實 OSM 幾何上）
- Modify: `pipeline/tools/` 對應的產生腳本，簽章後輸出到 Android 可 ingest 的 fixture
- Modify: `experiments/demo.md`

**Produces:** 一段可重播的 demo：
1. 西湖使用者規劃路線，最佳路線經過某條路，目的地是 A 避難所。
2. 透過 mesh 收到「該路 CLOSED」事件，路線自動改道。
3. 再收到「A 避難所額滿」事件，目的地換成 B。

這段 demo 同時展示「mesh 送來的資料改變了實際決策」，和專案的核心敘事連在一起。

- [ ] **Step 1: 選路。** 從真實 OSM 資料挑選有替代路線的路段，並在 demo 腳本中記錄 way id。
- [ ] **Step 2: 產生並簽章事件。** 每筆事件都要標明「合成模擬資料，不代表真實災況」。
- [ ] **Step 3: 兩機實機演練一次**，錄下改道的過程。

### Task 8: 文件與收尾

- [ ] README：「核心功能」新增離線逃生路線；「限制」補上以下幾點：
  - 只有步行路線。
  - 沒有高程資料。
  - OSM 快照可能缺少小路。
  - 避難所狀態靠名稱對應。
  - 路線只是依本機資料推算，不是官方疏散指示。
- [ ] `docs/mvp-remaining-tasks.md` G 段：勾選完成項目。
- [ ] `experiments/limitations.md`：把上述限制寫進去；另外註明群眾回報只加權不封鎖的理由。
- [ ] 全套測試：`flutter test`，以及既有的 `npm test`、`./gradlew testDebugUnitTest`，確認沒有被影響。

## 和「民眾回報 + 政府驗證」計畫的關係

- 兩個功能可以獨立開發。本計畫在群眾回報還沒實作時就能完成，那時 Task 2 的 `crowd.*` 規則用測試資料驗證即可。
- 政府查證後：`CONFIRMED` 的封路回報，是以官方確認事件的形式存在。第一版**不**把它自動升級為封鎖，因為確認事件只帶 verdict，不帶道路狀態。之後如果要做，應該由政府直接簽發一筆 `official.*` 的 `ROAD_STATUS`，而不是讓路線模組去解讀 attestation。

## 不在本計畫範圍

- 車行路線與 `oneway` 資料。
- 依高程或樓層做垂直避難建議。
- 即時人流與避難所壅塞預測。
- 語音導航與逐步轉彎指示。
- 把路線計算搬到 simulator 做群體疏散模擬。
