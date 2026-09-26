# 雙北離線步行路線與效能驗證

雙北使用 `android/app/src/main/assets/routing/taipei-walk.rgmz`。
原始內湖 `walk-roads.json`、產生工具與 golden 測試保留，供相容性回歸。
新增資產約 28.9 MB，以 Git LFS 保存。

路網來源為 [Geofabrik 的台灣 OpenStreetMap 快照](https://download.geofabrik.de/asia/taiwan.html)，
固定輸入 `taiwan-260925.osm.pbf`，SHA-256：
`05d5ae22b805feeae2720701391515e615c295e57fa21b23d16e02351c3ab6ff`。
來源、邊界和產出雜湊另存於路網 manifest；保留 © OpenStreetMap contributors / ODbL attribution。

涵蓋臺北市、新北市及縣市聯集外框約 2 公里的邊界緩衝區。道路保留原始 OSM
node ID，避免把不同高度但座標相同的橋梁、隧道或道路誤接成路口。
排除 `foot=no/private/use_sidepath`，以及未明確允許步行的 `access=no/private`。
`oneway:foot` 會限制步行方向，一般車輛單行道不會直接限制步行。
保留共用路口；其餘幾何以 1 公尺容許誤差精簡，長路段補上最多 60 公尺間距的定位節點。
這是本機 OSM 步行網路，不包含即時路況、高程或對所有場所入口的人工驗證。

## 重建

使用獨立 Python 環境並安裝 `osmium`（既有 search requirements 也包含此套件）。
下載輸入放 `tools/maps/.cache/`，不納入 Git。

```powershell
python -m venv tools/maps/.cache/routing-venv
tools/maps/.cache/routing-venv/Scripts/python.exe -m pip install -r tools/maps/requirements-search.txt
# 以下 python 使用上面的獨立環境；輸入 PBF 須先下載到 --input-pbf 路徑。
python tools/maps/build_taipei_walk_graph.py `
  --input-pbf tools/maps/.cache/taiwan-260925.osm.pbf `
  --source-date 2026-09-25 `
  --source-url https://download.geofabrik.de/asia/taiwan-260925.osm.pbf `
  --source-sha256 05d5ae22b805feeae2720701391515e615c295e57fa21b23d16e02351c3ab6ff
python -m unittest tools.maps.test_build_taipei_walk_graph
```

手機直接讀取預建的座標、路段、鄰接表、連通分量和空間索引，免除 JSON
解析及現場建圖。路線使用 A*；每條邊的成本仍包含既有災害、封路與群眾回報規則。
搜尋陣列由服務在 mutex 保護下重用；沒有封路時不再額外搜尋基準路線。
1,085,665 個節點、1,183,752 條路段、186,664 個 OSM way；最大連通分量含
1,072,617 個節點。道路是縣市聯集外框，並非只裁切行政區多邊形。

## App 延遲改善

- 全台道路 JSON 的解析、索引準備和文字搜尋在持續存在的背景 isolate 進行。
- 文字正規化結果快取，查詢只由輸入變更觸發；地圖重繪不會重跑搜尋。
- 單字／雙字 postings 與完整名稱反向比對，保留地址查詢的排名規則。
  只保存最佳 8 筆候選，必要時才推斷顯示用行政區，避免建立數十萬筆無用結果。
- Android 啟動不再先讀取之後會被已驗證來源取代的 preview 靜態資料。
- 底圖檔依內容版本及已安裝大小重用，免除每次開啟重新複製所有 PMTiles。
  更新先寫暫存檔再原子替換，失敗不會把上一份完整底圖截斷。
- 地圖樣式不因鍵盤開關重載，標記與行政區配置快取，拖動只更新座標。
- Android 實體像素轉成 Flutter 邏輯像素，修正停止拖動後標記移出畫面。
- 定位更新不重建所有靜態標記；5 公尺距離過濾減少 GPS 抖動造成的重繪。
  只使用 30 秒內、精度不超過 50 公尺的定位快取；新定位請求最多等待 10 秒。
- 修正 Android MapLibre 字型／圖示的 `flutter_assets/` 路徑。

## 驗證方式

`TaipeiWalkGraphTest` 驗證 12 個臺北市行政區和 29 個新北市行政區各有連通的
避難所與實際步行路線，並比較空間索引與完整掃描的候選路段。
這不代表所有避難所都有正確入口或所有道路都已現場查核。

`TaipeiRoutingPerformanceTest` 是實機 instrumentation 測試，不修改定位、
不送出回報、不清除 app 資料；涵蓋臺北、板橋、三重、新店、淡水及跨市橋梁。
接受標準為預建路網載入 < 5 秒、這組短程路線的暖機 p95 < 500 毫秒。

Android `profile` variant 使用 Flutter AOT，並沿用本機 debug 簽章，能覆蓋安裝
到開發手機並保留資料。畫面效能應以此版本衡量，debug 的 JIT 與檢查會增加成本。
debug/profile 提供 `ext.resilientgeo.performance` VM service extension，最多保存
600 個 frame timing；release 不註冊或收集此診斷資料。

## Pixel 8a 實測紀錄（2026-09-27）

USB 連線、Flutter AOT profile、手機 thermal status 1（輕度升溫）。
路線呼叫使用本機橋接與 Room 事件；instrumentation 則以空事件隔離路網運算。
每組路線重跑 6 次，第一次排除於暖機 p95；搜尋每個詞重跑 3 次。
拖動為 12 次 600 ms 橫向 swipe，統計最後 600 個 Flutter frame timing。

| 項目 | 最終觀察 |
| --- | ---: |
| instrumentation 路網載入（最後兩輪） | 2,247–3,614 ms |
| instrumentation 六組短程路線暖機 p95（nearest rank） | 11.3 ms |
| App 首次路線請求（新 process，含載入） | 1,798 ms |
| 冷啟動後全台道路搜尋準備完成（含 ADB／VM 連接） | 6,783 ms |
| App 六組短程路線暖機 p95 | 38.5 ms |
| App 含較長跨市路線的暖機 p95 | 68.6 ms |
| 約 7.4 km 臺北→板橋路線，六次最慢 | 115.9 ms |
| 約 19.9 km 淡水→板橋路線，六次最慢 | 116.6 ms |
| 一般搜尋 p95（成功路／板橋／中正路／板橋文化路地址） | 24.1–31.7 ms |
| 單字「路」搜尋，兩輪最慢 | 129.3 ms |
| 街道層級拖動 Flutter build p95 | 3.1 ms |
| 街道層級拖動 Flutter raster p95 | 4.1 ms |
| 街道層級拖動 Flutter total span p95 | 9.1 ms |
| 街道層級 build/raster 任一超過 16 ms 的 frame | 0 / 600 |
| 全台縮圖拖動 Flutter total span p95 | 8.9 ms |
| 全台縮圖 build/raster 任一超過 16 ms 的 frame | 0 / 600 |

搜尋數值包含 worker 往返，不包含 UI 的 180 ms 輸入 debounce。
道路索引在背景初始化；啟動初期的查詢暫時只搜尋已載入設施，索引準備完成後
會重跑目前的查詢。6.8 秒是初始化成本，不是每次搜尋都等待的時間；仍是後續可改善處。
Flutter frame timing 不等於完整 MapLibre GPU FPS 或觸控到螢幕顯示的延遲；
原生地圖另以實際拖動與停止後截圖檢查，確認標記保留且無 glyph/sprite 載入錯誤。
本次短程、跨市較長路線均回傳 `ok`，41 個行政區的避難所連通測試通過。
實際定位的推薦操作也顯示約 406 公尺路線；未修改定位或送出測試回報。

本輪接受門檻為首次路網載入 < 5 秒、暖機路線 p95 < 500 ms、一般搜尋 p95
< 100 ms、單字搜尋 < 150 ms，街道拖動 build/raster p95 均 < 16 ms；全部通過。
早期搜尋 p95 約 284 ms、單字搜尋最慢 680 ms，最終分別降到約 32 / 129 ms。
較早一輪長時間 USB 測試中載入曾達 5.79 秒；增大壓縮端讀取緩衝、手機休息後
後續兩輪測得 2.25–3.61 秒，不能將差異全歸因於程式改動，也不能保證所有溫度下低於 5 秒。

空間新增 28,891,043 bytes 路網；原本約 479 MB PMTiles 與舊內湖資料保留。
街道／較長路線測完的 app 總 PSS 約 1.10 GiB（含地圖圖形資源、全台搜尋、
雙北路網與 profile 引擎），Dart heap 使用約 247 MiB；並非只有路網的成本。
這次驗證針對 Pixel 8a，不代表較小記憶體手機或所有路段都具有相同表現。
多次重新啟動及覆蓋安裝後，五個 `files/maps/*.pmtiles` 大小、03:48 修改時間
均未改變，確認完整底圖直接重用。

最終檢查：234 項 Flutter 測試、135 項 Android JVM 測試、4 項產生器測試，
Flutter analyze、APK 內容與雜湊檢查，以及實機 instrumentation 全部通過。
原始 JSON 量測保存在本機忽略目錄 `.sim-out/pixel8a-verified-{overview,city}-latency.json`，
前幾輪亦保留於 `.sim-out/pixel8a-final-{overview,city}-latency.json`。
此表是有限案例的觀察，並非災害現場的安全性或全裝置效能保證。

## USB 重跑

```powershell
cd android
./gradlew :app:testDebugUnitTest :app:assembleProfile :app:assembleDebugAndroidTest -Ptarget-platform=android-arm64 --max-workers=2
cd ..
python tools/maps/check_routing_apk.py android/app/build/outputs/apk/profile/app-profile.apk
adb -s <serial> install -r android/app/build/outputs/apk/profile/app-profile.apk
adb -s <serial> install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s <serial> shell am instrument -w -e class com.resilientgeo.mesh.routing.TaipeiRoutingPerformanceTest com.resilientgeo.mesh.test/androidx.test.runner.AndroidJUnitRunner
adb -s <serial> shell am start -n com.resilientgeo.mesh/.MainActivity
python tools/maps/measure_android_latency.py --adb <adb.exe路徑> --serial <serial> --output .sim-out/latency.json --swipes
```

手機須顯示本 App 地圖；建議先用座標搜尋移到臺北或板橋街道層級，再量測拖動。
加上 `--long-routes` 會量測臺北／淡水到板橋；`--restart` 會重新啟動本 App，
另外記錄道路搜尋準備時間。鎖定測試手機時可與 `--over-keyguard` 一起使用。
若測試手機已鎖定，可在 debuggable 的 profile build 啟動時額外帶
`--ez performance_over_keyguard true`，使用 Android 的 `setShowWhenLocked` 顯示本 App。
此選項預設關閉，release 無效，手機鎖定和驗證設定不會改變。測完 force-stop，
以正常命令重開即可恢復一般顯示。全程不需假定位、清除資料或送出民眾回報。

路網副檔名使用 `.rgmz`：Android 會自動解壓縮並改名 `.gz` 資產。
APK 檢查驗證原始 gzip bytes／SHA-256、正確檔名、舊內湖檔案仍在，
並確認 PMTiles 與路網沒有再壓縮，避免打包記憶體耗盡及 range-read 延遲。
JVM 測試不使用 Android resources，故不為 unit test 額外打包全台底圖。
