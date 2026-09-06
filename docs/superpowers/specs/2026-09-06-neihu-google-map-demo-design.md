# 內湖 Google Maps Demo 設計

## 目標

將目前只有離線 `flutter_map` 的內湖地圖 Demo 改為有網路時使用 Google Maps Android SDK、無網路時使用現有 OSM 離線快照；同時補上百分比縮放控制、搜尋、目前位置、RWD marker、首頁／通知／個人導覽、深色模式與新事件動畫。

## 已確認的產品決策

- Demo 的線上底圖使用 `google_maps_flutter`，不是 Maps JavaScript API。
- 不預抓或下載 Google tiles；Google 底圖只在有網路時由 SDK 載入。
- OSM raster tiles 仍保留為離線 fallback。
- 搜尋第一版只查本機已打包的道路、避難所與醫療院所，不呼叫 Places API。
- 縮放 UI 顯示百分比：`0%` 是內湖全區，`100%` 是目前 provider 可用的街道最大細節；Google SDK 內部仍使用 numeric zoom。
- 所有 marker 使用 RWD 尺寸與必要的群組顯示，事件 marker 不佔滿畫面。
- 新事件沿用既有 EventChannel；只對新事件／新版本做一次脈動與通知提示，保留過期事件灰階規則。
- API key 不進 Git、不放 Flutter asset；使用 `GOOGLE_MAPS_API_KEY` 環境變數或被忽略的 `android/local.properties` 注入。
- Google key 只限制 `Maps SDK for Android`、`com.resilientgeo.mesh` 與對應 SHA-1；不在第一版啟用 Places、Geocoding 或 Directions。
- Android 原生仍擁有 Room、信任驗證、TTL、版本控管、BLE 與資料寫入權限；Flutter 只讀取橋接狀態。

## 架構

`MapAppController` 負責載入靜態 fixture、Room 事件、連線狀態、目前位置與使用者設定。`MapScreen` 只負責地圖頁呈現，依 `MapProviderMode` 選擇 `GoogleMap` 或 `FlutterMap`，兩者共用同一份 marker、polyline、polygon、搜尋與詳情資料。

有網路且 key 有效時，Google renderer 使用 `google_maps_flutter` 的 native platform view，透過 `GoogleMap` 提供正常／衛星／地形底圖與 camera gestures。無網路、缺少 key 或 Google map 建立失敗時，renderer 切換到現有 `AssetTileProvider`；切換不會移動或修改 Room 事件資料。底圖 attribution 依 provider 顯示 Google 或 OSM。

Android `MainActivity` 只負責 API key 的 manifest 注入與現有橋接，不搬移資料驗證。`local.properties` 與 CI environment 是唯一的實際 key 來源；範例設定只含 placeholder。

## UX

### 首頁

- 地圖佔主要畫面。
- 地圖上方是搜尋欄，搜尋結果顯示名稱、類型與地址摘要；點選後鏡頭 animated move 到地點。
- 右側放小型 `+`、`−`、目前位置與圖層按鈕；下方顯示 `縮放 NN%`，不顯示 `14 / 18`。
- 目前位置用藍色點。未授權定位時顯示可理解的提示，不假造座標。
- 事件 marker 約 28–32 logical px；新事件可有一次脈動，並可在個人設定關閉。
- 點擊 marker 開啟底部詳情 sheet；道路線狀事件仍以 polyline、區域事件以半透明 polygon 呈現。

### 通知

- 使用既有事件模型與 `apply_state`，依發布時間排序。
- 事件文字顯示類型、嚴重度、發布時間、有效期限與資料來源。
- Demo fixture 明確標示「模擬事件，非即時官方災情」；過期事件顯示「已過期」。

### 個人

- 語言第一版保留繁體中文選項介面。
- Light／Dark 由 Flutter `ThemeMode` 控制；Google 底圖使用本地 style JSON，OSM fallback 使用對應的暗色處理。
- 新事件動畫可切換，設定保留於本機。

## 錯誤與成本控制

- 沒有 key、網路斷線、Google renderer 建立失敗：顯示離線模式狀態並使用 OSM asset tiles。
- 搜尋不呼叫 Google Places，避免額外 API 費用；只搜尋本機 fixture。
- GoogleMap 在底部頁籤切換時用 `IndexedStack` 保留，不因切頁反覆建立 map view。
- API key 缺少時不得在畫面上顯示 key 內容；build log 不印出 key。
- Demo build 設定 Google Maps SDK daily quota；API key 不提交。

## 驗收

- 有網路且提供有效 key 時，APK 可顯示 Google 內湖地圖並正常拖曳、pinch、`+`、`−` 與滑桿縮放。
- 無網路時，APK 仍顯示 OSM 道路、避難所、醫療院所與事件。
- 搜尋本機的醫院、避難所或道路後，鏡頭移動且選取點顯示詳情。
- 390dp 寬度沒有 marker、搜尋欄、底部導覽或詳情卡互相遮蔽。
- 新事件由 EventChannel 進入後只提示一次；關閉動畫設定後不再脈動。
- `0%` 與 `100%` 分別對應 provider 的最小與最大允許 zoom；所有顯示均為百分比。
- Flutter analyze/test、Android unit test、debug APK、Python asset validator 與 Node tests 全部通過。
