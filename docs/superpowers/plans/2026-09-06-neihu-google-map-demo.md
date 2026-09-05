# 內湖 Google Maps Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將內湖 Flutter Demo 改成有網路使用 Google Maps、無網路回退現有 OSM 離線地圖，並完成百分比縮放、搜尋、定位、RWD marker、三頁導覽、深色模式與事件動畫。

**Architecture:** Flutter 建立共用的地圖 presentation state，`MapScreen` 依連線與 key 狀態選擇 `google_maps_flutter` 或既有 `flutter_map` asset renderer；兩個 renderer 共用 static features、Room events、搜尋結果與詳情資料。Android 僅注入受限制的 Google key、提供既有 Room/EventChannel/Emergency bridge 與定位權限，不移動信任驗證或資料寫入邏輯。

**Tech Stack:** Flutter 3.29-compatible Dart, `google_maps_flutter` 2.18.0, `connectivity_plus` 6.1.4, `geolocator` 13.0.2, `shared_preferences` 2.5.3, existing `flutter_map` 8.3.2, `latlong2` 0.10.1, Android Maps SDK, Kotlin/Gradle manifest placeholders.

**Spec:** `docs/superpowers/specs/2026-09-06-neihu-google-map-demo-design.md`

## Global Constraints

- Demo 的線上底圖使用 `google_maps_flutter`，不是 Maps JavaScript API。
- 不預抓或下載 Google tiles；Google 底圖只在有網路時由 SDK 載入。
- OSM raster tiles 仍保留為離線 fallback。
- 搜尋第一版只查本機已打包的道路、避難所與醫療院所，不呼叫 Places API。
- 縮放 UI 顯示百分比：`0%` 是內湖全區，`100%` 是目前 provider 可用的街道最大細節；Google SDK 內部仍使用 numeric zoom。
- API key 不進 Git、不放 Flutter asset；使用 `GOOGLE_MAPS_API_KEY` 環境變數或被忽略的 `android/local.properties` 注入。
- Android 原生仍擁有 Room、信任驗證、TTL、版本控管、BLE 與資料寫入權限；Flutter 只讀取橋接狀態。
- 切換底圖與底部頁籤不得清除或改寫 Room event state；Google map 建立失敗必須回退 OSM。
- 不修改 Flutter 產生的 `flutter/.android/`。

---

### Task 1: Google provider dependency and key injection

**Files:**

- Modify: `flutter/pubspec.yaml`
- Modify: `android/app/build.gradle.kts`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/gradle/libs.versions.toml` only if the Android dependency requires a catalog entry
- Create: `flutter/assets/map/google-map-light.json`
- Create: `flutter/assets/map/google-map-dark.json`
- Create: `tests/test_google_maps_config.py`
- Modify: `.gitignore`

**Produces:** A build-time `GOOGLE_MAPS_API_KEY` manifest placeholder sourced from environment first and `android/local.properties` second, plus Flutter dependencies and map style assets. No real key is committed.

- [ ] **Step 1: Write the failing configuration contract test.**

  Assert that pubspec contains the pinned map/connectivity/location/preferences packages; Gradle reads `GOOGLE_MAPS_API_KEY` and uses a manifest placeholder; the manifest includes `com.google.android.geo.API_KEY`, `INTERNET`, and location permissions; both style assets are nonempty; `.gitignore` contains `android/local.properties`.

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run `python3 -m unittest tests.test_google_maps_config -v` from the repository root. It must fail because the current project has no Google Maps dependency or key placeholder.

- [ ] **Step 3: Add dependencies and secure local configuration.**

  Add the exact Flutter dependencies from the plan. In `android/app/build.gradle.kts`, load `GOOGLE_MAPS_API_KEY` from `System.getenv` first, then `local.properties`, defaulting to an empty string; pass it only through `manifestPlaceholders`. In `AndroidManifest.xml`, set `android:value="${GOOGLE_MAPS_API_KEY}"` and add required network/location permissions. Do not add the key to Dart assets or source files.

- [ ] **Step 4: Add light/dark Google map styles and rerun the focused test.**

  Keep the JSON styles as local display styles with no map ID. Run `python3 -m unittest tests.test_google_maps_config -v`; expected result is PASS.

- [ ] **Step 5: Commit the provider configuration.**

  Run `git add flutter/pubspec.yaml flutter/pubspec.lock android/app/build.gradle.kts android/app/src/main/AndroidManifest.xml flutter/assets/map/google-map-light.json flutter/assets/map/google-map-dark.json tests/test_google_maps_config.py .gitignore` and commit with `feat(map): configure online Google Maps demo provider`.

### Task 2: Shared map presentation state, search, zoom percentage and location

**Files:**

- Create: `flutter/lib/data/map_zoom.dart`
- Create: `flutter/lib/data/map_search.dart`
- Create: `flutter/lib/data/map_runtime_state.dart`
- Create: `flutter/lib/data/location_controller.dart`
- Create: `flutter/test/map_zoom_test.dart`
- Create: `flutter/test/map_search_test.dart`
- Create: `flutter/test/map_runtime_state_test.dart`

**Interfaces:**

- `ZoomPercentage.fromZoom({required double zoom, required double minZoom, required double maxZoom}) -> int` clamps to `0..100` and rounds to the nearest integer.
- `ZoomPercentage.toZoom({required int percentage, required double minZoom, required double maxZoom}) -> double` clamps to `0..100` and maps linearly back to provider zoom.
- `MapSearchIndex(List<StaticFeature> features).query(String text) -> List<MapSearchResult>` searches feature name/address/details and returns at most 8 results, preserving source order for ties.
- `MapRuntimeState` holds `MapProviderMode { googleOnline, offline }`, `ThemeMode`, `zoomPercentage`, `currentLocation`, and `animationEnabled` without owning Room writes.

- [ ] **Step 1: Write failing unit tests for percentage mapping.**

  Cover `0` at min zoom, `100` at max zoom, midpoint rounding, values outside `0..100`, equal min/max safety, and both Google and offline ranges.

- [ ] **Step 2: Run `flutter test test/map_zoom_test.dart` and verify red.**

- [ ] **Step 3: Implement `ZoomPercentage` with the exact clamp and linear mapping.**

- [ ] **Step 4: Run the zoom tests and verify green.**

- [ ] **Step 5: Write failing local-search tests.**

  Build test features for a hospital, shelter, and road; assert name/address matches are case-insensitive, empty query returns no results, results contain type labels and coordinates, and no network service is called.

- [ ] **Step 6: Implement `MapSearchIndex` over existing `StaticFeature.details`, `id`, and `kind`.**

- [ ] **Step 7: Run `flutter test test/map_search_test.dart` and verify green.**

- [ ] **Step 8: Add runtime state and injectable location controller.**

  `LocationController` requests permission only after the user presses the current-location control, returns `null` on denied/unavailable location, and exposes a stream for later updates. `MapRuntimeState` must not invent a location or occupancy value.

- [ ] **Step 9: Test runtime state and commit.**

  Run `flutter test test/map_runtime_state_test.dart`; commit the four data/controller files and tests with `feat(map): add shared map presentation state`.

### Task 3: Google/OSM map renderer, overlays, search camera movement and animations

**Files:**

- Create: `flutter/lib/widgets/map_canvas.dart`
- Create: `flutter/lib/widgets/google_map_layers.dart`
- Create: `flutter/lib/widgets/map_zoom_controls.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Modify: `flutter/lib/widgets/map_layers.dart`
- Modify: `flutter/lib/widgets/feature_details_sheet.dart` only for responsive sizing if required
- Modify: `flutter/test/map_screen_test.dart`
- Modify: `flutter/test/map_interaction_test.dart`
- Create: `flutter/test/map_provider_test.dart`

**Interfaces:**

- `MapCanvas` accepts `MapRuntimeState`, static features, visible events, callbacks for feature/event selection, search focus, location, layer settings, and zoom percentage; it renders exactly one active provider.
- `MapCanvas` uses `MapProviderMode.googleOnline` only when a configured key and network state are available; otherwise it renders the existing asset OSM map.
- Google and OSM overlays use the same `PointGeometry`, `LineStringGeometry`, and `PolygonGeometry` models and preserve `eventColor`, expired gray state, and source labels.

- [ ] **Step 1: Add failing provider/widget tests.**

  Test that the renderer exposes Google mode when injected online/configured, offline mode when network is unavailable or key is empty, percentage zoom displays `0%`, `50%`, and `100%`, and the explicit `+`/`−` controls change the displayed percentage.

- [ ] **Step 2: Implement `MapCanvas` with GoogleMap and existing FlutterMap branches.**

  Google branch uses `initialCameraPosition`, `minMaxZoomPreference`, `cameraTargetBounds`, `markers`, `polylines`, `polygons`, `circles`, `onCameraMove`, and `onMapCreated`; OSM branch retains `AssetTileProvider`, but adds explicit controls and uses the offline provider's max zoom. Neither branch makes a tile HTTP request from Dart.

- [ ] **Step 3: Implement shared Google overlays and responsive marker sizes.**

  Use 28–32 logical px markers, group co-located facilities, keep event markers smaller than the old 50px buttons, and add a non-blocking pulse circle/animation for newly observed events. Respect `MediaQuery.disableAnimations` and the user's animation setting.

- [ ] **Step 4: Connect search and location callbacks.**

  Search result selection calls `animateCamera` on Google or `MapController.move` on OSM, updates the percentage label, and shows the selected feature detail. Current location uses native Google blue-dot support online and a Flutter blue marker offline after explicit permission.

- [ ] **Step 5: Preserve existing detail and layer behavior.**

  Keep shelter capacity versus current occupancy semantics, event expiry, overlap chooser, polyline/polygon click details, and Android EventChannel updates. Add regression tests for shelter, hospital, event, overlap, and offline fallback.

- [ ] **Step 6: Run focused Flutter tests and commit the renderer.**

  Run `/Users/ray/Development/flutter/bin/flutter test test/map_provider_test.dart test/map_screen_test.dart test/map_interaction_test.dart`; expected result is PASS. Commit with `feat(map): add responsive Google and offline renderers`.

### Task 4: App shell, bottom navigation, notifications, profile settings, documentation and full verification

**Files:**

- Create: `flutter/lib/app/map_app_controller.dart`
- Create: `flutter/lib/screens/notifications_screen.dart`
- Create: `flutter/lib/screens/profile_screen.dart`
- Create: `flutter/lib/widgets/app_bottom_navigation.dart`
- Modify: `flutter/lib/main.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Modify: `flutter/test/map_interaction_test.dart`
- Create: `flutter/test/app_shell_test.dart`
- Modify: `README.md`
- Modify: `android/README.md`
- Modify: `system.md`

**Interfaces:**

- `MapAppController` loads static/demo/Room events once, exposes an event stream to map and notifications, stores `ThemeMode` and `animationEnabled` in `SharedPreferences`, and keeps one map alive through `IndexedStack`.
- `AppBottomNavigation` exposes `首頁`, `通知`, and `個人` with a badge count from unexpired/unread events.
- `NotificationsScreen` renders event text from the verified event model and explicitly labels demo events.
- `ProfileScreen` changes language selection UI, light/dark theme, and animation setting without writing Room.

- [ ] **Step 1: Write failing shell widget tests.**

  Cover three tabs, map preservation across tab switches, notification event text, profile theme toggle, animation toggle, and responsive layout at 390px width.

- [ ] **Step 2: Implement `MapAppController` and `IndexedStack` shell.**

  Reuse the existing bridge loading and EventChannel subscription; do not create a second Room access path. Keep the map controller mounted while another tab is selected.

- [ ] **Step 3: Implement notification and profile screens.**

  Use the shared Material 3 color scheme; apply Google light/dark style and OSM dark treatment when theme changes; keep all secondary text readable and all controls within SafeArea.

- [ ] **Step 4: Run shell tests and fix responsive layout.**

  Run `/Users/ray/Development/flutter/bin/flutter test test/app_shell_test.dart test/map_interaction_test.dart`; expected result is PASS at the default test size and a 390px constrained test size.

- [ ] **Step 5: Update documentation with key setup and preview commands.**

  Document `GOOGLE_MAPS_API_KEY` in ignored `android/local.properties`, package/SHA-1 restrictions, online Google versus offline OSM behavior, and Android Studio run instructions. State that the provided JavaScript sample is not the Flutter Android implementation.

- [ ] **Step 6: Run the complete verification suite.**

  Run:

  ```bash
  cd flutter && /Users/ray/Development/flutter/bin/flutter analyze
  cd flutter && /Users/ray/Development/flutter/bin/flutter test
  cd android && bash ./gradlew testDebugUnitTest --no-daemon --console=plain
  cd android && bash ./gradlew assembleDebug --no-daemon --console=plain
  cd .. && python3 -m unittest discover -s tests -v
  cd .. && python3 tools/validate-neihu-map-assets.py
  cd .. && npm test
  ```

  Confirm the debug APK contains Flutter assets and the build does not print the API key. Record the Android NDK warning separately if it remains; do not edit generated `flutter/.android/`.

- [ ] **Step 7: Commit the app shell and documentation.**

  Commit with `feat(app): finish Neihu Google Maps demo shell`.
