# Chrome 與 Android 共用離線地圖前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Chrome 與 Android 共用台灣 PMTiles、style、glyph、sprite、Flutter UI 與互動契約，並移除 Chrome 對 unpkg、gstatic 與 fonts.gstatic 的必要依賴。

**Architecture:** Android 繼續使用 MapLibre Native 與 app-private PMTiles；Chrome 使用 self-hosted MapLibre GL JS 6.4.1 與 localhost PMTiles assets。兩平台共用 Flutter UI、style JSON、搜尋索引與 marker；接受兩個不同地圖 renderer 的微小抗鋸齒、字距與 label collision 差異，不改成 Android WebView。

**Tech Stack:** Flutter 3.29.2、Dart 3.7.2、`maplibre_gl` 0.27.1、MapLibre GL JS 6.4.1、Protomaps PMTiles、Flutter Web CanvasKit、Lucide icons、Playwright CLI。

**Spec:** `docs/superpowers/specs/2026-09-23-cross-platform-offline-map-runtime-design.md`

## Global Constraints

- Chrome 與 Android 共用同一組 PMTiles、glyph、sprite、style 與台灣道路搜尋索引。
- Chrome MapLibre Web runtime 固定使用 self-hosted MapLibre GL JS 6.4.1，不允許 unpkg CDN fallback。
- Chrome 離線 preview 使用 Flutter 3.29.2 支援的 `--no-web-resources-cdn`，不依賴 `gstatic.com` 或 `fonts.gstatic.com`。
- 不新增 Google Maps、raster tile、線上地理編碼、Places API 或災情 API。
- 不修改 Android Room、BLE、事件驗證、TTL 或資料格式。
- 不新增 z17 台灣資料；既有 z17 仍是 overzoom。
- 不把 Android 改成 WebView；不承諾 Android Native 與 Chrome GL JS 逐像素完全相同。
- 不執行 `git add`、`git commit` 或 `git push`，除非使用者另行要求。

## Review Focus

- **外部 runtime 請求：** Chrome 離線重載仍請求 CanvasKit、Roboto 或 MapLibre CDN；由 Task 1、Task 2、Task 3 的 URL tests 與 network-off 驗收固定。
- **MapLibre worker／MIME：** ESM 可以載入但 worker 相對路徑或 `.mjs` MIME 錯誤；由 Task 2 的 self-host smoke test 固定。
- **本機地圖資產：** style 任何 source、glyph 或 sprite 偷換成遠端 URL；由 Task 4 的完整 style URI test 固定。
- **Platform-view 事件：** 搜尋結果或 controls 點擊後仍被 MapLibre canvas 收到並關閉詳情；由 Task 5 的 widget test 與 Chrome interaction check 固定。
- **跨 renderer 視覺差異：** Android 與 Chrome 使用不同 engine 時 label collision、字距與抗鋸齒不同；由 Task 6 的共用 token／style check 與雙平台人工驗收界定可接受差異。

---

### Task 1: 建立本機 MapLibre Web runtime 設定邊界

**Files:**
- Create: `flutter/lib/data/maplibre_web_runtime.dart`
- Create: `flutter/test/maplibre_web_runtime_test.dart`
- Modify: `flutter/lib/main.dart:1-18`

**Interfaces:**
- Produces `MapLibreWebRuntime.version == '6.4.1'`。
- Produces `MapLibreWebRuntime.source({required Uri baseUri}) -> MapLibreJsSource`，script 與 CSS URL 都由 `baseUri` 解析，不含 `unpkg.com`。
- Produces `MapLibreWebRuntime.configure({Uri? baseUri}) -> void`，只在 Web 設定 `MapLibreMap.webLibrarySource`。

- [ ] **Step 1: Write the failing tests**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'package:resilientgeo_flutter/data/maplibre_web_runtime.dart';

void main() {
  test('uses the pinned local MapLibre GL JS runtime', () {
    final source = MapLibreWebRuntime.source(
      baseUri: Uri.parse('http://localhost:8787/'),
    );

    expect(MapLibreWebRuntime.version, '6.4.1');
    expect(
      source.scriptUrl,
      'http://localhost:8787/maplibre/6.4.1/dist/maplibre-gl.mjs',
    );
    expect(
      source.styleUrl,
      'http://localhost:8787/maplibre/6.4.1/dist/maplibre-gl.css',
    );
    expect(source.scriptUrl, isNot(contains('unpkg.com')));
    expect(source.styleUrl, isNot(contains('unpkg.com')));
  });

  test('returns the public CDN-free source type', () {
    final source = MapLibreWebRuntime.source(
      baseUri: Uri.parse('http://localhost:8787/'),
    );

    expect(source, isA<MapLibreJsSource>());
    expect(source.preloaded, isFalse);
  });
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `flutter/`:

```bash
/Users/ray/Development/flutter/bin/flutter test test/maplibre_web_runtime_test.dart
```

Expected: FAIL because `maplibre_web_runtime.dart` and `MapLibreWebRuntime` do not exist.

- [ ] **Step 3: Implement the smallest runtime configuration**

Create `MapLibreWebRuntime` with these exact constants and methods:

```dart
import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

abstract final class MapLibreWebRuntime {
  static const version = '6.4.1';
  static const scriptPath = 'maplibre/6.4.1/dist/maplibre-gl.mjs';
  static const stylePath = 'maplibre/6.4.1/dist/maplibre-gl.css';

  static MapLibreJsSource source({required Uri baseUri}) =>
      MapLibreJsSource.urls(
        scriptUrl: baseUri.resolve(scriptPath).toString(),
        styleUrl: baseUri.resolve(stylePath).toString(),
      );

  static void configure({Uri? baseUri}) {
    if (!kIsWeb) return;
    MapLibreMap.webLibrarySource = source(baseUri: baseUri ?? Uri.base);
  }
}
```

In `main()` call `MapLibreWebRuntime.configure()` before `registerOfflineMapProtocol()`. This order is required because the protocol registration waits for `MapLibreMap.ensureWebLibraryLoaded()`.

- [ ] **Step 4: Run the focused test and analyzer**

```bash
/Users/ray/Development/flutter/bin/flutter test test/maplibre_web_runtime_test.dart
/Users/ray/Development/flutter/bin/flutter analyze
```

Expected: focused tests pass and analyzer reports no issues.

### Task 2: Vendor MapLibre GL JS 6.4.1 and prove its browser loading path

**Files:**
- Create: `flutter/web/maplibre/6.4.1/dist/` containing the complete MapLibre GL JS 6.4.1 `dist` directory
- Create: `flutter/web/maplibre/6.4.1/LICENSE`
- Create: `flutter/web/maplibre/6.4.1/metadata.json`
- Create: `flutter/test/maplibre_web_assets_test.dart`
- Modify: `tools/maps/README.md`

**Interfaces:**
- Consumes `MapLibreWebRuntime.scriptPath` and `MapLibreWebRuntime.stylePath` from Task 1.
- Produces local ESM, CSS, worker-relative files, license and SHA-256 metadata.

- [ ] **Step 1: Add the asset-presence tests before copying runtime files**

The test must check these files relative to the Flutter package root:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('self-hosted MapLibre runtime files are present', () {
    final requiredFiles = <String>[
      'web/maplibre/6.4.1/dist/maplibre-gl.mjs',
      'web/maplibre/6.4.1/dist/maplibre-gl.css',
      'web/maplibre/6.4.1/LICENSE',
      'web/maplibre/6.4.1/metadata.json',
    ];

    for (final path in requiredFiles) {
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: path);
      expect(file.lengthSync(), greaterThan(0), reason: path);
    }
  });
}
```

- [ ] **Step 2: Run the asset test to verify it fails**

```bash
/Users/ray/Development/flutter/bin/flutter test test/maplibre_web_assets_test.dart
```

Expected: FAIL for the missing local runtime files.

- [ ] **Step 3: Vendor the pinned package without editing generated JavaScript**

Use a temporary directory and the pinned npm package:

```bash
vendor_dir="$(mktemp -d)"
npm pack maplibre-gl@6.4.1 --pack-destination "$vendor_dir"
tar -xzf "$vendor_dir"/maplibre-gl-6.4.1.tgz -C "$vendor_dir"
```

Copy the complete extracted `package/dist/` contents into `flutter/web/maplibre/6.4.1/dist/`, copy the package license, and create `metadata.json` containing:

```json
{
  "package": "maplibre-gl",
  "version": "6.4.1",
  "source": "npm package maplibre-gl@6.4.1",
  "script": "dist/maplibre-gl.mjs",
  "style": "dist/maplibre-gl.css",
  "runtime": "self-hosted"
}
```

Add a `sha256` object containing the SHA-256 value of every copied runtime file to
the metadata, and document the package license/source in `tools/maps/README.md`.

- [ ] **Step 4: Run asset and runtime URL tests**

```bash
/Users/ray/Development/flutter/bin/flutter test test/maplibre_web_assets_test.dart test/maplibre_web_runtime_test.dart
```

Expected: all tests pass; no test may refer to `unpkg.com`.

- [ ] **Step 5: Run a Chrome smoke test with external MapLibre requests blocked**

Start the app with the local Flutter resources option from Task 3, open it in Chrome, and inspect requests. The only MapLibre runtime requests must be paths beginning with `/maplibre/6.4.1/`; an attempted `https://unpkg.com/` request is a failure.

### Task 3: Make Flutter Web engine resources and UI fonts local

**Files:**
- Create: `flutter/lib/theme/app_theme.dart`
- Create: `flutter/test/app_theme_test.dart`
- Create: `flutter/assets/fonts/NotoSansTC-Regular.ttf`
- Create: `flutter/assets/fonts/NotoSansTC-Medium.ttf`
- Modify: `flutter/lib/main.dart:20-55`
- Modify: `flutter/pubspec.yaml` font and asset declarations
- Modify: `README.md` Chrome startup and offline preview sections
- Modify: `system.md` Chrome／Android offline boundary

**Interfaces:**
- Produces `AppTheme.light()` and `AppTheme.dark()` returning `ThemeData` with the same bundled `NotoSansTC` family.
- Produces two supported commands:
  - Debug UI: `flutter run -d chrome --no-web-resources-cdn --web-port 8787`
  - Offline preview: `flutter build web --release --no-web-resources-cdn`

- [ ] **Step 1: Add the failing theme/font test**

```dart
import 'package:flutter_test/flutter_test.dart';

import 'package:resilientgeo_flutter/theme/app_theme.dart';

void main() {
  test('light and dark themes use the bundled UI font', () {
    expect(AppTheme.light().fontFamily, 'NotoSansTC');
    expect(AppTheme.dark().fontFamily, 'NotoSansTC');
  });
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

```bash
/Users/ray/Development/flutter/bin/flutter test test/app_theme_test.dart
```

Expected: FAIL because `AppTheme` does not exist.

- [ ] **Step 3: Add the bundled font and move theme construction into `AppTheme`**

Obtain the pinned Noto Sans TC font files from the official Noto Fonts source, record source revision and SHA-256 in `tools/maps/README.md`, and declare them in `flutter/pubspec.yaml`:

```yaml
flutter:
  fonts:
    - family: NotoSansTC
      fonts:
        - asset: assets/fonts/NotoSansTC-Regular.ttf
        - asset: assets/fonts/NotoSansTC-Medium.ttf
          weight: 500
```

Move the existing `_theme(Brightness)` implementation from `main.dart` into `AppTheme.light()` and `AppTheme.dark()`, preserving the current color scheme and Material 3 settings. Replace the two `theme:` references in `MaterialApp` with `AppTheme.light()` and `AppTheme.dark()`.

- [ ] **Step 4: Run theme tests, analyzer, and the local-resource debug command**

```bash
/Users/ray/Development/flutter/bin/flutter test test/app_theme_test.dart
/Users/ray/Development/flutter/bin/flutter analyze
/Users/ray/Development/flutter/bin/flutter run -d chrome --no-web-resources-cdn --web-port 8787
```

Expected: the browser no longer requests Flutter CanvasKit from `gstatic.com` or Roboto from `fonts.gstatic.com` during normal startup. Stop the debug server after the check.

- [ ] **Step 5: Build and inspect the self-contained offline preview**

```bash
/Users/ray/Development/flutter/bin/flutter build web --release --no-web-resources-cdn
test -f build/web/flutter_bootstrap.js
test -f build/web/canvaskit/canvaskit.js
rg -n "gstatic.com|fonts.gstatic.com|unpkg.com" build/web
```

Expected: `flutter_bootstrap.js` and local CanvasKit exist; the `rg` command returns no required runtime URL. Keep `build/web` generated and ignored; do not commit build output.

### Task 4: Lock shared style and local asset URI behavior

**Files:**
- Modify: `flutter/lib/data/offline_map_asset_store.dart:38-86`
- Modify: `flutter/test/offline_map_asset_store_test.dart`
- Modify: `flutter/test/map_style_assets_test.dart`
- Modify: `flutter/assets/map/styles/taiwan-light.json`
- Modify: `flutter/assets/map/styles/taiwan-dark.json`
- Modify: `tools/maps/README.md`

**Interfaces:**
- `OfflineMapAssetStore.rewriteWebStyleAssetUris()` remains the single Web URI rewrite boundary.
- Both styles continue to expose only local `pmtiles://asset://assets/...`, `asset://assets/map/fonts/...`, and `asset://assets/map/sprites/...` references before rewrite.

- [ ] **Step 1: Add failing assertions for every style source**

Extend `map_style_assets_test.dart` to parse both styles and add regression
assertions for every source:

```dart
expect(style['glyphs'], startsWith('asset://assets/'));
expect(style['sprite'], startsWith('asset://assets/'));
for (final source in (style['sources'] as Map).values) {
  expect((source as Map)['url'], startsWith('pmtiles://asset://assets/'));
}
expect(jsonEncode(style), isNot(contains('http://')));
expect(jsonEncode(style), isNot(contains('https://')));
```

Extend `offline_map_asset_store_test.dart` to verify that the rewritten source becomes a localhost URL and keeps the `pmtiles://` protocol while `glyphs` and `sprite` resolve below `Uri.base.resolve('assets/')`.

- [ ] **Step 2: Run the focused tests and verify the regression boundary**

```bash
/Users/ray/Development/flutter/bin/flutter test test/map_style_assets_test.dart test/offline_map_asset_store_test.dart
```

Expected: the current local styles pass, and the assertions fail if a future
style edit introduces an HTTP(S) source, glyph URL, sprite URL, or non-PMTiles
source. This is a regression test; it does not require changing the already
local styles just to force a red test.

- [ ] **Step 3: Make only the minimum style/rewriter corrections**

Keep the existing five PMTiles sources and local attribution. Do not add an online fallback. If the self-hosted runtime changes the base path, update only `rewriteWebStyleAssetUris()` and its tests so all assets remain under the current localhost origin.

- [ ] **Step 4: Run the complete asset/style test group**

```bash
/Users/ray/Development/flutter/bin/flutter test test/map_style_assets_test.dart test/offline_map_asset_store_test.dart test/offline_map_manifest_test.dart test/offline_map_package_files_test.dart
```

Expected: all local asset, manifest hash, bbox and zoom tests pass.

### Task 5: Isolate Flutter controls from the MapLibre HTML platform view

**Files:**
- Modify: `flutter/pubspec.yaml` to add `pointer_interceptor: 0.10.1+2`
- Modify: `flutter/lib/screens/map_screen.dart:378-410`
- Modify: `flutter/lib/widgets/map_canvas.dart:700-780`
- Modify: `flutter/test/map_screen_test.dart`
- Modify: `flutter/test/map_interaction_test.dart`

**Interfaces:**
- Search selection continues through `_selectSearchResult(MapSearchResult result)`.
- Map空白點擊 continues through the existing `onMapTap` callback.
- Search and control overlays are wrapped with a Web-safe pointer interceptor; markers remain handled by `hitTestMapMarkers()` and MapLibre `onMapClick`.

- [ ] **Step 1: Add failing interaction tests**

Add a widget test that enters a known local search result, taps it, and asserts all three states remain true after the tap:

```dart
expect(find.text('潭美國小'), findsOneWidget);
expect(find.byType(FeatureDetailsSheet), findsOneWidget);
expect(find.byKey(const ValueKey<String>('map-search-field')), findsOneWidget);
```

Add a second test that taps a non-marker map area after closing the search result and asserts the details sheet closes. The two tests must distinguish a consumed search/control tap from a basemap tap.

- [ ] **Step 2: Run the focused tests before the Web fix**

```bash
/Users/ray/Development/flutter/bin/flutter test test/map_screen_test.dart test/map_interaction_test.dart
```

Expected: the Flutter widget tests may pass because the VM test environment has
no HTML platform view. The real failure boundary is the Chrome interaction
check in Step 5; the widget tests establish the intended state contract before
the Web-only fix.

- [ ] **Step 3: Add the smallest pointer isolation boundary**

Add the pinned `pointer_interceptor` package, wrap `_SearchOverlay` and `MapZoomControls` with its `PointerInterceptor`, and leave `MapCanvas._onMapClick()` responsible for true map clicks and marker hit-tests. Do not wrap the complete `MapCanvas`, because doing so would prevent map panning and zooming.

Keep `_selectSearchResult()` responsible for setting `_searchSelection`, `_focusPoint`, `_selectedFeature` and `_focusRequestId`; do not duplicate selection state inside the map widget.

- [ ] **Step 4: Run focused tests and verify direct marker behavior remains intact**

```bash
/Users/ray/Development/flutter/bin/flutter test test/map_screen_test.dart test/map_interaction_test.dart test/map_layers_test.dart
```

Expected: search results keep the detail sheet open, blank map taps close it, marker taps still open the correct feature, and overlapping marker selection remains unchanged.

- [ ] **Step 5: Verify the real Chrome pointer path**

Using the Playwright CLI against `http://localhost:8787`:

1. Fill `map-search-field` with `潭美國小`.
2. Click the result row.
3. Confirm the camera focuses the result and the bottom detail sheet remains visible.
4. Click map whitespace and confirm the detail sheet closes.
5. Click a marker and confirm the marker detail sheet opens.

Expected: no search/control click appears in MapLibre's map click path.

### Task 6: Full cross-platform offline acceptance and documentation

**Files:**
- Modify: `README.md:116-143`
- Modify: `system.md:233-238`
- Modify: `android/README.md` Chrome／offline verification sections
- Modify: `tools/maps/README.md` runtime source and license sections
- Create: `tools/maps/test_no_remote_map_runtime.py`

**Interfaces:**
- Documentation exposes separate debug and offline-preview commands.
- The static check exits non-zero when app-owned runtime files contain
  forbidden runtime URLs.

- [ ] **Step 1: Add the failing remote-runtime scan**

Create `tools/maps/test_no_remote_map_runtime.py` with a `--root` argument. By
default it scans only these app-owned runtime paths:

```text
flutter/lib
flutter/assets/map
flutter/web
flutter/pubspec.yaml
```

It must fail for `unpkg.com`, `gstatic.com`, `fonts.gstatic.com`, Google Maps
package names, and remote OSM tile URL templates. The scanner must always allow
the local `pmtiles://` protocol and OSM/Protomaps attribution text. README and
system documentation are updated in this task but are not treated as runtime
source by this scanner, because they may truthfully mention removed dependencies
or external source/licensing URLs.

- [ ] **Step 2: Prove the scanner detects a forbidden URL, then scan the app**

```bash
fixture_dir="$(mktemp -d)"
mkdir -p "$fixture_dir/flutter/lib"
printf '%s\n' 'https://unpkg.com/maplibre-gl@6.4.1/dist/maplibre-gl.mjs' \
  > "$fixture_dir/flutter/lib/forbidden-runtime-fixture.txt"
if python3 tools/maps/test_no_remote_map_runtime.py --root "$fixture_dir"; then
  echo 'scanner accepted forbidden fixture' >&2
  exit 1
fi
python3 tools/maps/test_no_remote_map_runtime.py --root .
```

Expected: the temporary fixture scan exits non-zero, proving the detector
works. The current project scan may pass before implementation because the
`maplibre_gl_web` CDN default lives in the installed pub cache, not in the
app-owned files; the browser smoke test is what proves the runtime no longer
uses that default after Task 1.

- [ ] **Step 3: Update developer commands and boundary statements**

Document exactly:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
/Users/ray/Development/flutter/bin/flutter pub get
/Users/ray/Development/flutter/bin/flutter run -d chrome --no-web-resources-cdn --web-port 8787
```

Document offline preview separately:

```bash
/Users/ray/Development/flutter/bin/flutter build web --release --no-web-resources-cdn
python3 -m http.server 8780 --directory build/web
```

State that Android uses native MapLibre and app-private PMTiles, while Chrome uses local MapLibre GL JS and local Flutter Web resources. State that minor renderer-level visual differences are accepted.

- [ ] **Step 4: Run the complete verification suite**

```bash
/Users/ray/Development/flutter/bin/flutter analyze
/Users/ray/Development/flutter/bin/flutter test
/Users/ray/Development/flutter/bin/flutter build web --release --no-web-resources-cdn
python3 tools/maps/test_no_remote_map_runtime.py
git diff --check
```

Expected: analyzer, tests, build and remote-runtime scan all pass. The generated `build/web` directory remains untracked/ignored.

- [ ] **Step 5: Perform final Chrome and Android acceptance**

Chrome:

- Start with `--no-web-resources-cdn`.
- Confirm MapLibre runtime, PMTiles, style, glyph, sprite and search assets come from localhost.
- Disable external network while keeping the local server available.
- Reload and test map, search, marker details, zoom, location, light/dark and controls.

Android:

- Build and install the debug APK.
- Enable airplane mode.
- Force-stop and relaunch the app.
- Test the same map and UI flows.
- Confirm no Google Maps key, remote tile request or web runtime request is needed.

## Handoff

After the user approves this plan, use `superpowers:executing-plans` for native implementation or `superpowers:subagent-driven-development` for task-by-task implementation with independent review. The recommended approach is native execution because the tasks share the `MapLibreWebRuntime` and asset URI interfaces, and the main risk is concentrated in the local web runtime／engine integration rather than independent product features.
