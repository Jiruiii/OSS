# Flutter 內湖離線災情地圖 Implementation Plan

## Goal

將現有 Android XML 主畫面改為 Flutter 地圖主畫面，支援內湖離線道路、避難所、醫療院所與事件詳情；保留 Android 原生 Room、事件驗證、TTL、版本控管、BLE 與 transport activities。

## Architecture and constraints

- Flutter 負責畫面與地圖互動；Android 原生保留資料信任邊界、Room、事件驗證、TTL、版本控管與 BLE。
- Flutter 透過 MethodChannel／EventChannel 取得已驗證事件；靜態地圖資料以版本化 offline assets 提供。
- 使用 Flutter add-to-app source-code subproject，不修改 Flutter 產生的 `.android/`。
- 使用 `flutter_map` 與 `latlong2`，地圖只使用 `AssetTileProvider`，不提供線上 tile fallback。
- 離線快照 bbox 為 `[121.5519933, 25.0518603, 121.6286149, 25.1151519]`，道路來源保留目前 live OSM snapshot 的 5,774 條道路。
- 避難所顯示預計容量；`available_count`／目前收容人數無資料時一律為 JSON `null` 並在 UI 顯示「無資料」，不可補 0。
- Demo 事件必須標示「模擬事件／非即時官方災情」；過期事件保留並灰階顯示。
- Flutter 不可直接寫 Room；`loadBundledFixture()` 必須走既有 `MeshRepository.ingestBundledFixture()`。

## Task 1: 建立 Flutter add-to-app module

建立 `flutter/` module，使用與 host app 不同的 Android package name；加入 `flutter_map`、`latlong2` 相容版本；更新 `android/settings.gradle.kts`、`android/app/build.gradle.kts`，把 `MainActivity` 改成 Flutter host，但保留現有 service、transport activities、Room 類別。不可修改 `.android/` generated files。

## Task 2: 建立可重現的內湖離線資料與 tiles

建立 `data/fixtures/neihu/offline-map-display-v1.json`、`tools/build-neihu-offline-tiles.py`、`tools/validate-neihu-map-assets.py`、`flutter/assets/data/neihu/static-features.json` 與 committed raster tiles `flutter/assets/map/tiles/{z}/{x}/{y}.png`。資料需包含 5,774 條道路、26 個避難所、4 個醫療院所；tiles 覆蓋 zoom 12–17，zoom 17 可辨識道路。驗證 bbox、座標、唯一 ID、tile 覆蓋與 `available_count == null`。

## Task 3: 建立 Android ↔ Flutter 資料橋接

建立 `FlutterMapBridge.kt`、`map_bridge.dart`、`map_models.dart`。提供 channels `com.resilientgeo.mesh/map` 與 `com.resilientgeo.mesh/events`，methods `getInitialState()`、`loadBundledFixture()`、`setEmergencyMode({enabled})`。Android 從 Room 取完整 `eventJson`，加入 `apply_state` 後推送；Flutter 解析 Point、LineString、Polygon，缺欄位顯示「無資料」。

## Task 4: 實作 Flutter 地圖主畫面與詳情面板

建立 `map_screen.dart`、`map_layers.dart`、`feature_details_sheet.dart`、`layer_filter_panel.dart` 與必要測試。A 方案地圖佔主畫面，支援拖曳、縮放、回內湖範圍、圖層開關；避難所、醫療院所、事件 marker、LineString、Polygon 都要可點擊。點擊後由底部展開 B 式詳情面板；重疊 marker 顯示選擇器；主畫面顯示離線可用、快照時間、模擬事件警語。

## Task 5: 測試、文件與驗收

補齊 Flutter model/parser unit tests、map widget tests、Android bridge tests；同步 Android/UI 文件中的現況。驗證 `flutter analyze`、`flutter test`、`flutter build apk --debug`、`cd android && bash ./gradlew testDebugUnitTest`、`npm test`、`python3 tools/validate-neihu-map-assets.py`，並確認離線操作與既有 BLE／Room tests 不受影響。
