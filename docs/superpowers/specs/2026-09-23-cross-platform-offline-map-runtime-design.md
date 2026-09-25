# Chrome 與 Android 共用離線地圖前端設計

## 目標

讓 Chrome UI 開發環境與 Android App 共用同一套台灣地圖資料、地圖樣式、Flutter UI、marker 與互動契約，並且在沒有外部網路時仍能啟動與顯示地圖。

本設計的「一致」定義為：

- 共用同一組台灣 PMTiles、glyph、sprite、style 與搜尋索引。
- 共用同一組 Flutter UI、Lucide marker、搜尋、詳情面板、縮放與定位行為。
- Chrome 與 Android 都不依賴 Google Maps、線上 raster tile、線上地理編碼或線上災情 API。
- 允許 MapLibre Native 與 MapLibre GL JS 因平台渲染器不同造成的抗鋸齒、字距、標籤碰撞與細微像素差異。

不承諾 Android 與 Chrome 逐像素完全相同；若要逐像素相同，必須讓 Android 也使用 WebView + MapLibre GL JS，這會改變目前 Android 原生 MapLibre 架構，不在本次範圍。

## 現況與問題邊界

### 已經是本機資料的部分

- `taiwan.pmtiles` 與北／中／南／東分區 PMTiles 隨 Flutter assets 打包。
- light／dark style、glyph、sprite 與道路搜尋索引隨 Flutter assets 打包。
- Web style 會把 `asset://` 與 `pmtiles://asset://` 改寫成目前 localhost 的 asset URL。
- Android 會將 PMTiles 複製到 app-private 目錄，再由原生 MapLibre 讀取。

### 尚未完全離線的部分

- `maplibre_gl_web` 未設定 `MapLibreMap.webLibrarySource` 時，預設從 unpkg 載入 `maplibre-gl@6.4.1` 的 ESM 與 CSS。
- Flutter Web 開發啟動目前會依賴 Flutter engine 的 CanvasKit 與 Roboto 外部資源；目前錯誤紀錄已證實會請求 `gstatic.com` 與 `fonts.gstatic.com`。
- Chrome 的 MapLibre widget 是 `HtmlElementView` platform view；Flutter 搜尋 overlay、詳情面板與 MapLibre DOM canvas 之間存在瀏覽器 hit-test 邊界。
- 搜尋結果點擊可能先選取結果、再被 MapLibre map click 關閉詳情面板；這是互動事件問題，不是 PMTiles 來源問題。

## 目標架構

```text
Flutter UI
├── 共用 SearchOverlay／StatusOverlay／DetailsSheet／BottomNavigation
├── 共用 Map style JSON、glyph、sprite、PMTiles、搜尋索引
├── Android：MapLibre Native + app-private PMTiles
└── Chrome：MapLibre GL JS self-hosted + localhost PMTiles assets

Chrome runtime
├── 本機 Flutter Web engine／CanvasKit／字型
├── 本機 maplibre-gl.mjs、maplibre-gl.css 與 worker 資源
└── 本機 pmtiles.js、protocol bridge 與 Flutter assets
```

### 1. Self-host MapLibre GL JS

新增一份固定版本的 MapLibre GL JS Web runtime，版本與 `maplibre_gl_web` 目前使用的 6.4.1 對齊，至少包含：

- `maplibre-gl.mjs`
- `maplibre-gl.css`
- 該版本需要的 worker／相對路徑資源

檔案放在 Flutter Web 可被 localhost 與 release static server 提供的目錄，並保留完整 `dist` 相對路徑。不可只複製單一 `.mjs`，因 MapLibre 會依 script URL 解析 worker 路徑。

在第一個 `MapLibreMap` 建立前設定：

```dart
if (kIsWeb) {
  MapLibreMap.webLibrarySource = MapLibreJsSource.urls(
    scriptUrl: Uri.base.resolve('maplibre/maplibre-gl.mjs').toString(),
    styleUrl: Uri.base.resolve('maplibre/maplibre-gl.css').toString(),
  );
}
```

實際路徑以 build output 與 Flutter dev server 的 MIME type 驗證結果為準。若本機 runtime 缺檔，不使用 CDN fallback，而是顯示可診斷的啟動錯誤。

### 2. Flutter Web engine 與字型本機化

Flutter Web runtime 必須從本機提供，不能把 MapLibre 資料本機化後仍依賴 Google CDN。

實作前先以目前 Flutter 3.29.2 的正式支援方式確認：

- release web build 是否可以提供本機 CanvasKit 資源。
- dev server 是否能以同一組本機 engine 資源啟動 hot reload。
- `flutter_bootstrap.js` 的 engine base URL 是否需要明確設定。
- Roboto 或選定的 UI 字型是否需要加入 Flutter assets，並在 `ThemeData` 指定。

選定方案後，Chrome 在離線啟動時的 Network 面板不得再出現 `gstatic.com` 或 `fonts.gstatic.com` 的必要請求。Map label 使用的 Protomaps glyph 仍由既有本機 glyph assets 提供。

若 Flutter SDK 不允許在 `flutter run -d chrome` 直接使用完整本機 engine，則把驗收拆成：

- 開發模式：允許暫時使用本機 dev server 所需的 SDK engine，但地圖資料與 MapLibre runtime 必須本機。
- 離線 preview：使用自包含 `build/web` static server 驗證完全離線。

兩種模式必須在 README 明確區分，不再把 Chrome 開發模式直接宣稱為完整離線。

### 3. 共用樣式與資料契約

保留目前 `taiwan-light.json` 與 `taiwan-dark.json` 作為 Android／Chrome 唯一樣式來源：

- source 一律指向本機 PMTiles protocol。
- glyph、sprite、attribution 一律指向本機資產。
- roads、buildings、water、landuse、places 與 POI layer 的 zoom／filter 規則兩平台共用。
- 災情、避難所與醫療 marker 仍由 Flutter overlay 渲染，使用共用 Lucide icon catalog。
- 不加入線上 fallback；本機資料缺失時顯示錯誤狀態，不偷偷切換到 OSM tile server。

平台允許的差異只限於 MapLibre Native／GL JS 的渲染差異，不允許資料來源或樣式規則分叉。

### 4. Chrome platform view 互動隔離

搜尋、縮放、圖層、定位與詳情面板屬於 Flutter UI；MapLibre canvas 屬於 HTML platform view。兩者需建立明確事件邊界：

- 搜尋結果點擊必須只執行選取、聚焦與開啟詳情，不得再觸發 `onMapTap` 關閉詳情。
- 搜尋 overlay 與右下角 controls 必須能阻擋 platform view 下方的 pointer event。
- marker 點擊維持目前 screen-coordinate hit-test fallback，重疊 marker 維持既有選擇語意。
- 點擊真正的 basemap 空白區域才執行關閉詳情。
- 地圖拖曳與縮放不能改變 marker 的資料座標；投影更新必須在相機事件中同步處理。

優先採用既有 Flutter event flow 加上 Web platform-view pointer isolation；若標準 Flutter hit-test 在 Chrome 仍無法阻擋底層 DOM，再引入最小範圍的 pointer interceptor dependency，不重做 menu bar 或控制項。

## 不在本次範圍

- 不修改 Android Room、BLE、事件驗證、TTL 或資料格式。
- 不新增線上地理編碼、路線規劃、Places API 或災情 API。
- 不新增 z17 台灣資料；目前 z17 仍只是既有資料的 overzoom。
- 不把 Android 改成 WebView。
- 不追求兩個不同 MapLibre engine 的逐像素 screenshot 相同。
- 不執行 Git add、commit 或 push。

## 測試與驗收

### 靜態檢查

- 搜尋 app source、style、web assets 與 pubspec，確認沒有 Google Maps、raster tile 或未預期的 OSM tile URL。
- 確認 MapLibre Web loader 的 script／CSS 路徑不是 `unpkg.com`。
- 確認 Flutter Web bootstrap 與字型設定不要求外部 CDN 才能顯示 UI。
- 確認所有本機 runtime 檔案的 license、版本與來源紀錄。

### Flutter tests

- style source、glyph、sprite 與 PMTiles URI 改寫測試。
- Web runtime URL 設定測試，禁止 CDN fallback。
- 搜尋結果選取後詳情面板保持開啟。
- 搜尋結果不觸發 MapLibre `onMapTap` 關閉詳情。
- marker hit-test、重疊 marker、定位、縮放與回到台灣預設視角。

### Chrome 驗收

1. 開啟 Chrome UI。
2. 在 Network 面板確認 MapLibre runtime、style、glyph、sprite、PMTiles 與搜尋索引均來自 localhost。
3. 阻擋外部網路後重新載入頁面。
4. 地圖、道路、建物、地名、marker、搜尋與詳情面板仍可使用。
5. 搜尋結果點擊後鏡頭移動且詳情面板保持顯示。

### Android 驗收

1. 建置含 PMTiles 與本機資產的 debug APK。
2. 開啟飛航模式。
3. 完全結束 App 後重新啟動。
4. 驗證地圖、marker、搜尋、詳情、淺色／深色與定位功能。
5. 確認沒有 Google Maps key、線上 tile 或 Web runtime 依賴。

## 執行順序

1. 先完成 MapLibre GL JS self-host spike，確認 Flutter 3.29.2 的 ESM、worker 與 MIME type 可在 Chrome 載入。
2. 完成 Flutter Web engine／字型本機化方案，先以最小離線啟動案例驗證。
3. 將共用 style、PMTiles、glyph、sprite 與 runtime wiring 整合到現有 MapCanvas。
4. 修正搜尋 overlay 的 platform-view pointer isolation。
5. 以 TDD 補測試，再做 Chrome network-off 與 Android 飛航模式驗收。
6. 更新 README、system 文件與啟動指令，清楚區分 Chrome 開發模式、Chrome 離線 preview 與 Android 離線 App。

