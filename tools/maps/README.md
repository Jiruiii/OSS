# 台灣 Protomaps PMTiles

> 2026-09-27：除了全台底圖與道路搜尋，已新增雙北離線步行路網產生器、APK 資產檢查及 Pixel 8a USB 延遲量測工具。底圖涵蓋全台，路線目前只涵蓋雙北及邊界緩衝區。

Flutter 的 MapLibre 樣式使用五個本機 PMTiles 檔案：

| 檔案 | bbox（minLon,minLat,maxLon,maxLat） | zoom |
| --- | --- | --- |
| `taiwan.pmtiles` | `118.0,21.8,122.2,26.5` | z0–12 |
| `taiwan-north.pmtiles` | `118.0,24.0,122.2,26.5` | z13–15 |
| `taiwan-central.pmtiles` | `118.0,23.0,121.6,24.1` | z13–15 |
| `taiwan-south.pmtiles` | `118.0,21.8,121.6,23.8` | z13–15 |
| `taiwan-east.pmtiles` | `120.8,21.8,122.2,25.5` | z13–15 |

資料來源是 Protomaps daily build；以 Git LFS 管理，不要把大型檔案轉成一般 Git blob。

## Chrome MapLibre Web runtime

Chrome 使用隨 App 內嵌的 MapLibre GL JS `6.4.1`，檔案位於
`flutter/web/maplibre/6.4.1/dist/`，由 `maplibre_gl` 的 Web adapter 以本機
URL 載入。`dist/` 必須整個保留，因 ESM runtime 會以相對路徑載入 worker。
版本、來源與每個檔案的 SHA-256 記錄在
`flutter/web/maplibre/6.4.1/metadata.json`。

此 runtime 依 MapLibre GL JS 的 BSD-3-Clause license 發佈；完整授權文字保留
在 `flutter/web/maplibre/6.4.1/LICENSE`。不要將 Web runtime 改回 unpkg CDN，
也不要只替換 `maplibre-gl.mjs` 而漏掉 worker 或 CSS。

## Flutter Web UI font

Flutter UI 使用本機打包的 Noto Sans TC variable font，來源固定在 Google Fonts
repository commit `e44c4b011a820c2cbe2fd2cfa8052037d7edb571`：
`ofl/notosanstc/NotoSansTC[wght].ttf`。同一份 variable font 以 Regular 與
Medium 兩個 asset 名稱宣告，讓 Material text theme 在不同 weight 仍只從 App
資產載入。

兩個檔案的 SHA-256 都是
`864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`，license
為 SIL Open Font License 1.1。Flutter CanvasKit 的 Roboto fallback 也已固定放在
`flutter/web/fonts/roboto/v32/`，其 SHA-256 是
`35b02ca266b79eb4996590f15817425a1ce9ebf48f84471843233ff614656bf2`，metadata
記錄在同一目錄。`flutter/web/flutter_bootstrap.js` 將 fallback base URL 指向
這個本機目錄，因此 App runtime 不需要從外部字型 CDN 載入 UI 字型；若需要更新
字型，必須更新 commit、hash 與來源紀錄。

## 重建與驗證

先安裝 [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli)，再執行：

```bash
git lfs pull
PMTILES_BIN=pmtiles SOURCE_DATE=20260921 \
  ./tools/maps/build_taiwan_pmtiles.sh
```

腳本會對每個 archive 執行 `show --header-json`、`verify` 與 SHA-256。來源日期、bbox、zoom 與目前檔案 hash 也必須同步更新
`flutter/lib/data/offline_map_manifest.dart`，再執行：

```bash
cd flutter
flutter test test/offline_map_manifest_test.dart \
  test/offline_map_package_files_test.dart
```

Chrome UI 與 offline preview：

```bash
cd flutter
flutter run -d chrome --no-web-resources-cdn --web-port 8787
flutter build web --release --no-web-resources-cdn
```

PMTiles 內容依 OSM／Protomaps 授權保留 attribution；樣式中的 attribution 不可移除。

## 台灣離線道路搜尋索引

App 內的道路與經緯度搜尋完全使用本機資料，不會在執行期間呼叫
Nominatim、Google Geocoding 或直接讀取 PMTiles。道路搜尋資產是從指定日期的
Geofabrik Taiwan OSM PBF 產生，座標在 JSON 中固定使用 `[longitude, latitude]`。

建立工具需要 Python 3.13（或其他有相容 wheel 的版本）與固定 major range 的
`osmium` 套件；`osmium` 是 pyosmium 專案在 PyPI 的 distribution name：

```bash
python3.13 -m venv /private/tmp/resilientgeo/search-build
/private/tmp/resilientgeo/search-build/bin/python -m pip install \
  -r tools/maps/requirements-search.txt
```

下載 PBF 後先取得 hash，再產生資產。產生器會重新計算並比對 hash，失敗時不會寫
輸出檔：

```bash
mkdir -p /private/tmp/resilientgeo
curl -L --fail --output /private/tmp/resilientgeo/taiwan-latest.osm.pbf \
  https://download.geofabrik.de/asia/taiwan-latest.osm.pbf
shasum -a 256 /private/tmp/resilientgeo/taiwan-latest.osm.pbf

/private/tmp/resilientgeo/search-build/bin/python \
  tools/maps/build_taiwan_search_index.py \
  --input-pbf /private/tmp/resilientgeo/taiwan-latest.osm.pbf \
  --source-date 2026-09-22 \
  --source-url https://download.geofabrik.de/asia/taiwan-latest.osm.pbf \
  --source-sha256 "$(shasum -a 256 /private/tmp/resilientgeo/taiwan-latest.osm.pbf | cut -d ' ' -f 1)" \
  --output flutter/assets/map/search/taiwan-roads.json
```

輸出包含 `schema_version`、`dataset_id`、`snapshot_at`、來源 URL/hash、OSM
attribution 與排序後的 `entries`。每個 entry 包含 stable `id`、道路名稱、aliases、
`kind: road`、行政區（可能為 null）與台灣 bbox 內的代表座標。產生器會排除 bbox
外的離島資料，並對有道路名稱但沒有可用幾何的資料失敗。

小型 JSON fixture 僅供 generator contract test 使用，不是 App 的 runtime fallback：

```bash
python3 -m unittest tools/maps/test_build_taiwan_search_index.py -v
```

## 雙北路網與實機效能（2026-09-27）

| 工具 | 用途 |
| --- | --- |
| `build_taipei_walk_graph.py` | 從固定日期、核對 SHA-256 的 Taiwan PBF 預建雙北步行圖、鄰接表、連通分量與空間索引 |
| `test_build_taipei_walk_graph.py` | 驗證步行存取／方向、共用路口保留、簡化與節點間距、可重現輸出 |
| `check_routing_apk.py` | 核對 `.rgmz` 檔名與 gzip bytes、manifest 雜湊，確認 PMTiles 未重壓縮且內湖 JSON 仍在 |
| `measure_android_latency.py` | 透過指定 USB serial 與 profile VM service 量測搜尋、路線、拖動 frame、記憶體與升溫狀態 |

產物 `android/app/src/main/assets/routing/taipei-walk.rgmz` 約 28.9 MB，以 Git LFS 管理；
來源日期 2026-09-25，1,085,665 節點／1,183,752 路段。保留原始內湖工具與資產。
副檔名不可直接改為 `.gz`，Android 打包會自動解壓並改名，導致 runtime 找不到檔案。

量測工具只操作指定的測試 App，不修改 GPS、不清除手機資料、不送出回報。
`--restart` 量測新 process 與道路搜尋初始化，`--swipes` 量測拖動，
`--long-routes` 加入臺北／淡水到板橋；鎖定的 debuggable 測試手機可搭配
`--restart --over-keyguard`，測完恢復正常啟動。

重建環境、固定輸入雜湊、實機結果及限制見 [雙北路線與效能文件](../../docs/taipei-offline-routing.md)。
