# 台灣離線地圖互動與全台搜尋設計

## 目標

修正 Flutter MapLibre 地圖在拖曳、定位、縮放與搜尋時的互動行為，讓：

- 災情、避難所、醫療院所 marker 固定在其經緯度，不因拖曳而漂移或延遲。
- 使用者可以離線搜尋台灣道路名稱與經緯度。
- 「目前位置」會真正將鏡頭移到裝置座標，定位失敗時會給出可理解的提示。
- `0%` 是台灣概覽，而不是看到大範圍台灣以外的區域。
- 低縮放層級不顯示過量地名，高縮放仍保留街道與建物密度。

本設計維持 MapLibre + Protomaps PMTiles、OSM attribution、Lucide marker、Room／BLE／事件驗證與既有災情資料契約不變。

## 範圍與非目標

### 範圍

- Flutter MapLibre marker 投影與 camera request lifecycle。
- 全台灣離線道路搜尋索引。
- 十進位經緯度搜尋。
- 台灣概覽鏡頭、最小／最大 zoom 與地名顯示密度。
- Chrome UI 預覽、Android／實機離線互動測試。

### 非目標

- 不新增線上 Nominatim、Google Geocoding 或其他地理編碼服務。
- 不新增路線規劃、導航或地址反查。
- 不修改 Room、BLE、事件信任、TTL 或通知資料流。
- 不在本次把地圖資料提高到 z17；現有 z16–17 仍屬 z15 資料的 overzoom。
- 不重新設計 menu bar、縮放控制與定位控制的視覺結構。

## 現況與根因

### Marker 漂移

目前 [map_canvas.dart](../../../flutter/lib/widgets/map_canvas.dart) 在 `onCameraMove` 後呼叫非同步 `toScreenLocationBatch`，再把 Flutter marker 放到 `Stack` 的畫面座標。MapLibre camera 移動與 platform channel 回應不同步，造成拖曳期間 marker 顯示上一個 camera 的座標。

現有 `MapMarkerProjectionGate` 只能丟棄過期回應，不能消除 platform channel 的延遲，因此它是必要的防 stale-result 機制，但不是即時投影方案。

### 目前位置未置中

裝置位置經由 [location_controller.dart](../../../flutter/lib/data/location_controller.dart) 的 Geolocator 取得。權限、服務或平台呼叫失敗時會轉成 `null`，目前 [map_screen.dart](../../../flutter/lib/screens/map_screen.dart) 沒有顯示失敗原因。

背景 `locationUpdates` 只更新 `MapRuntimeState.currentLocation`，不產生 camera request；這個行為應保留，避免使用者拖曳地圖時被背景定位拉回去。只有明確按下「目前位置」才建立新的 camera request。

### 搜尋資料不足

`MapSearchIndex` 目前只掃描 `StaticFeatureCollection.features`，其資料主要是內湖 fixture。PMTiles 是 tile archive，不是可直接進行全台全文搜尋的索引，因此必須在建置階段從同一批台灣 OSM 輸入產生獨立的搜尋資產。

### Zoom 與地名密度

目前 overview camera 會以台灣本島、澎湖、金門與東南離島的聚焦範圍計算 zoom，並固定以台灣中心為 target；完整資料範圍仍保留馬祖等離島。camera 不設硬性 bounds，因此仍可平移到其他離島或台灣以外區域。UI 的 `0%` 對應 reset overview，而不是把 camera 鎖死在 bbox 內。樣式中的 overview `places` layer 只在較高 zoom 顯示，避免低縮放時地名過密。

## 設計決策

### A. Marker 採同步 Web Mercator 投影，保留 Flutter overlay

不把 app 自有 marker 改成 MapLibre native symbol 作為第一版方案。改在 Flutter 端使用 `CameraPosition.target`、`CameraPosition.zoom` 與地圖 viewport size，計算無 bearing／無 pitch 下的 Web Mercator screen position。

流程如下：

```text
MapLibre onCameraMove
  -> MapCameraProjection.projectAll
  -> 更新 Flutter marker positions
  -> MapLibre onCameraIdle
  -> toScreenLocationBatch 校正最後一幀
```

理由：

- 保留現有 Lucide `IconData`、Flutter Semantics、點擊與重疊選擇。
- 不需要把每個 Lucide icon 轉成 platform bitmap。
- 拖曳期間不再等待 platform channel 的非同步回應。
- 投影公式可以用純 Dart 單元測試驗證。

`MapMarkerProjectionGate` 仍保留給 idle 校正與 radar position，不能讓過期的校正結果覆蓋最新 camera。

若 Android／Web 實機驗證證明同步公式在特定 platform view 尺寸下仍有不可接受誤差，後續才評估 MapLibre native symbol layer；本次不預先擴大成兩套 marker renderer。

### B. Camera request 使用遞增 request id

保留現有 `focusPoint`／`focusRequestId` 概念，但將 camera request 的語意集中化：

- `current-location`：取得定位成功後建立，使用 `locationZoom`。
- `search`：選擇道路或座標後建立，使用搜尋 focus zoom。
- `taiwan-overview`：回到預設時建立，使用台灣概覽 camera。
- 背景定位更新：只更新 marker，不建立 request。

每一個 request 必須在 MapLibre controller 與 style ready 後執行；若 request 在 style ready 前產生，style callback 只執行最新 request。

定位失敗時：

- 不清空既有有效位置。
- 不移動 camera。
- 顯示「無法取得目前位置，請開啟瀏覽器或裝置定位權限」。

### C. 全台灣搜尋索引

新增建置工具與版本化資產：

```text
tools/maps/build_taiwan_search_index.py
flutter/assets/map/search/taiwan-roads.json
```

索引輸入使用一份明確釘選的台灣 OSM PBF source snapshot。建置指令必須接收並記錄 `SOURCE_DATE`、`SOURCE_URL` 與 `SOURCE_SHA256`；若沒有輸入 PBF 或 hash 不符，建置直接失敗，不以未驗證的資料產生索引。PMTiles 目前由 Protomaps daily build 擷取，只有在兩者 source date／hash 已驗證一致時才可在 metadata 宣稱同一份 snapshot；不得把這個一致性當成未驗證的假設。

`taiwan-roads.json` 根物件包含 `schema_version`、`dataset_id`、`snapshot_at`、`source_url`、`source_sha256`、`attribution` 與 `entries`。App 只讀取 `entries`，但測試與文件必須驗證 metadata 存在。

建置工具可以使用具備 OSM PBF 解析能力的本機工具或固定版本套件，但不得把 PBF、解壓檔或套件快取提交到 repository；執行時仍不得讀取網路或反查 PMTiles。

每筆索引記錄至少包含：

```json
{
  "id": "road:<stable-source-id>",
  "name": "中山路",
  "aliases": ["Zhongshan Road"],
  "kind": "road",
  "region": "臺北市",
  "coordinate": [121.5201, 25.0478]
}
```

規則：

- 座標一律以 `[longitude, latitude]` 儲存，與 GeoJSON／PMTiles 一致。
- 優先使用 `name:zh-Hant`，沒有才使用 `name` 或 `ref`。
- 以標準化名稱、行政區與 source id 去重，避免同一條道路的每個 tile segment 造成大量重複結果。
- 同名道路保留不同行政區／代表點，搜尋結果最多顯示 8 筆。
- 建置輸出排序固定、JSON key 固定，讓 diff 與 hash 可重現。
- 暫存 PBF、解壓檔與中間產物放在 `tools/maps/.cache/` 或 `tools/maps/.work/`，不得進 Git。

Flutter 搜尋層拆成兩種候選來源：

1. App-owned static features：避難所、醫療院所與目前內湖 fixture。
2. Bundled Taiwan road index：全台道路與必要地名。

經緯度輸入先經過 parser；支援逗號或空白分隔的 latitude／longitude，並驗證台灣本島與主要離島範圍 `118.0–122.2 longitude`、`21.8–26.5 latitude`。無效或超出範圍時顯示搜尋錯誤，不建立 camera request。

搜尋道路或座標只移動 camera，不把道路假裝成避難所／醫療 feature，也不開啟錯誤的設施詳細資訊 sheet。

### D. 台灣概覽與地名層級

MapLibre camera 設定調整為：

- `minZoom` 保留為 MapLibre 的安全下限；reset overview 以聚焦範圍 fit camera 產生實際 zoom，並將該狀態顯示為 `0%`。
- overview target 固定為台灣中心；reset focus 包含本島、澎湖、金門與東南離島，完整資料範圍另外保留馬祖，camera 仍允許平移到其他區域。
- `maxZoom` 維持 17；文件明確標示 z16–17 是 z15 vector overzoom。
- `cameraTargetBounds` 使用 `unbounded`，避免 MapLibre 在 viewport 大於台灣 bbox 時自動放大並把 target 移到 bbox 中心；reset 的聚焦責任由 app 自己的 fit camera 處理。
- 預設 camera 完成後同步更新 UI 的 0–100% zoom state，不再只依賴 platform callback。

樣式的 light／dark 兩份都同步調整：

- overview z7.5–9.5：只顯示國家、區域與主要縣市層級。
- z9.5–12：逐步加入 locality，並維持 collision placement。
- z13–14：顯示分區 PMTiles 的主要地名。
- z15 以上：顯示必要 POI，降低非關鍵 POI label 密度；道路線與建物密度不刪除。

### E. Attribution 與離線邊界

維持五個 PMTiles、glyph、sprite、style 的本機來源與 OSM／Protomaps attribution。搜尋索引也屬 OSM 衍生資料，需在 README／tools/maps 文件補充來源日期與 attribution，不新增線上 fallback。

## 預計檔案變更

### Flutter

- 建立 `flutter/lib/data/map_camera_projection.dart`：純 Dart Web Mercator 投影與 viewport 計算。
- 修改 `flutter/lib/widgets/map_canvas.dart`：接收 camera move position、同步更新 marker、執行 idle 校正與 camera request。
- 修改 `flutter/lib/screens/map_screen.dart`：集中 current-location／search／overview request，處理定位錯誤與 road／coordinate search result。
- 修改 `flutter/lib/data/map_search.dart`：支援 static feature、road index、coordinate parser 與統一 search result。
- 建立 `flutter/lib/data/map_search_asset.dart`：讀取並驗證全台灣搜尋資產 metadata 與 entries。
- 修改 `flutter/lib/data/maplibre_map_config.dart`：台灣 bounds、min／overview zoom 與 camera state。
- 修改 `flutter/lib/widgets/map_layers.dart`：必要時新增搜尋 focus marker descriptor，但不改 menu bar／縮放控制 icon。
- 修改 `flutter/pubspec.yaml`：加入 `assets/map/search/taiwan-roads.json`。

### 地圖資料與工具

- 建立 `tools/maps/build_taiwan_search_index.py`。
- 修改 `tools/maps/README.md`：說明搜尋索引來源、重建指令、hash 與 attribution。
- 修改 `flutter/assets/map/styles/taiwan-light.json`。
- 修改 `flutter/assets/map/styles/taiwan-dark.json`。
- 修改 `.gitignore`：只忽略搜尋索引建置暫存，不忽略版本化的 `taiwan-roads.json`。

### 測試與文件

- 建立 `flutter/test/map_camera_projection_test.dart`。
- 修改 `flutter/test/map_search_test.dart`：道路索引、座標 parser、台灣範圍與結果排序。
- 修改 `flutter/test/maplibre_map_config_test.dart`：min zoom、bounds、overview camera。
- 修改 `flutter/test/map_interaction_test.dart`：定位 request、搜尋 request 與 marker 行為。
- 修改 `flutter/test/map_style_assets_test.dart`：兩套樣式的 label zoom 規則。
- 修改 README／system.md：全台搜尋索引與 z15／z17 overzoom 邊界。

## 錯誤處理與相容性

- 搜尋資產不存在或 JSON 格式錯誤：地圖仍可啟動，搜尋只保留 static features，並顯示「全台道路搜尋資料尚未安裝」。
- Geolocator 權限拒絕：保留台灣預設鏡頭，不生成虛構座標。
- MapLibre platform callback 失敗：同步投影仍維持 marker；idle 校正失敗只記錄並等待下一次 camera idle。
- Camera request 過時：以 request id 丟棄，不覆蓋最新搜尋／定位目標。
- 非有限或超出範圍座標：不傳入 MapLibre camera。
- Chrome 使用瀏覽器定位時遵守瀏覽器 permission；UI 開發沒有定位時仍使用台灣概覽。

## 驗收條件

### Chrome

- 拖曳地圖時所有 app-owned marker 與其地理位置同步，不在拖曳結束後跳位。
- 點擊「目前位置」時，若瀏覽器允許定位，camera 移到位置；若拒絕，顯示錯誤訊息。
- 輸入 `25.011549, 121.545053` 能移動到指定位置。
- 輸入台灣道路名稱能顯示搜尋結果並移動 camera。
- `0%` 顯示台灣概覽，畫面不再以中國／菲律賓為主要範圍。
- 圖層切換與 marker 點擊不會改變 camera target。

### Android 飛航模式

- 無網路、無 Google key 時仍可啟動。
- 台灣 PMTiles、road search index、glyph、sprite 全部使用本機資產。
- 定位成功後 camera、目前位置 marker 與 zoom state 一致。
- marker 拖曳期間不漂移；避難所、醫院、災情重疊點仍可選擇。
- 淺色／深色樣式的地名層級一致。

### 靜態檢查

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter analyze
flutter test
git diff --check
```

另需以搜尋工具驗證輸出排序、重建可重現、OSM attribution、搜尋 asset 存在與索引 hash。

## 風險與取捨

1. 同步投影依賴 MapLibre 的無旋轉、無傾斜 camera 條件；目前 UI 已關閉 rotate／tilt，因此適合本輪。若未來開放旋轉，需改成 native symbol 或擴充含 bearing／pitch 的投影。
2. 全台道路索引會增加 App 資產大小；先以去重後的道路名稱／行政區／代表點索引控制大小，若實際超過可接受範圍，再評估 SQLite FTS，但不在本輪引入資料庫。
3. z17 不會自動增加街道資料細節；若驗收仍認為巷弄密度不足，需另行產製台灣 z17 PMTiles，不能靠提高 UI 百分比宣稱已改善資料覆蓋。
