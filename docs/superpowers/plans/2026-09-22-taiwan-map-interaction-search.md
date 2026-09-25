# Taiwan Map Interaction and Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the offline Taiwan MapLibre map keep app markers locked to geographic coordinates, support offline all-Taiwan road and coordinate search, reliably focus the current location, and use Taiwan-focused zoom and label density.

**Architecture:** Keep app-owned marker widgets in Flutter for Lucide icons, overlap selection, and accessibility, but replace asynchronous per-camera projection with synchronous Web Mercator projection from the current MapLibre `CameraPosition`; use an idle platform projection only as a final correction. Load a versioned all-Taiwan road index generated from a pinned OSM PBF, merge it with existing static feature search, and drive all camera movement through typed request IDs.

**Tech Stack:** Flutter/Dart 3.7, `maplibre_gl` 0.27.1, `geolocator` 13.0.2, local Protomaps PMTiles, Python 3 build tooling, Flutter widget/unit tests.

**Spec:** `docs/superpowers/specs/2026-09-22-taiwan-map-interaction-search-design.md`

## Global Constraints

- App remains offline-first: no runtime Nominatim, Google Geocoding, or other network fallback.
- App-owned marker interaction remains in Flutter and keeps Lucide icons, overlap selection, and accessibility semantics.
- Coordinates use `[longitude, latitude]` in JSON/GeoJSON; `MapLibre LatLng` receives `latitude, longitude`.
- Background location updates update the marker only; explicit current-location action creates a camera request.
- `0%` is the Taiwan-centered overview for the main island, Penghu, Kinmen, and the southeast islands; the full PMTiles range still retains Matsu for panning.
- OSM/Protomaps attribution, Room, BLE, event trust, TTL, and event data contracts remain unchanged.
- Do not run `git add`, `git commit`, merge, or push; leave all implementation changes in the working tree for review.

## Review Focus

- A marker must not lag or jump after a rapid pan: `MapCameraProjection` tests cover center, zoom, longitude wrapping, and viewport changes; Chrome/Android smoke checks cover drag behavior.
- A coordinate query must accept `lat, lon`, reject non-finite/out-of-Taiwan coordinates, and never create a camera request on invalid input: parser tests cover each branch.
- Two roads with the same name in different regions must remain distinct results: search-index tests cover stable id, region, coordinate, and deterministic ordering.
- A denied or unavailable location must not erase a previously valid location or move the camera: location interaction tests cover null gateway results and explicit focus requests.
- The overview camera must remain Taiwan-focused while z15 street data stays visible at high zoom: config/style tests cover bounds, zoom limits, and label layer thresholds.

---

### Task 1: Add synchronous MapLibre camera projection

**Files:**
- Create: `flutter/lib/data/map_camera_projection.dart`
- Create: `flutter/test/map_camera_projection_test.dart`
- Modify: `flutter/lib/widgets/map_canvas.dart:334-406, 550-671`

**Interfaces:**
- Produces `MapCameraProjection.projectPoint({required GeoPoint point, required GeoPoint cameraTarget, required double zoom, required Size viewportSize}) -> Offset`.
- Produces `MapCameraProjection.projectPoints({required Iterable<GeoPoint> points, required GeoPoint cameraTarget, required double zoom, required Size viewportSize}) -> List<Offset>` with input order preserved.
- Consumes `CameraPosition.target`, `CameraPosition.zoom`, the `MapCanvas` viewport size, and existing `MapMarkerData.point` values.

- [ ] **Step 1: Write the failing projection tests**

Add tests with a 1000×800 viewport:

```dart
test('projects the camera target to the viewport center', () {
  final screen = MapCameraProjection.projectPoint(
    point: const GeoPoint(longitude: 121.0, latitude: 23.5),
    cameraTarget: const GeoPoint(longitude: 121.0, latitude: 23.5),
    zoom: 8,
    viewportSize: const Size(1000, 800),
  );
  expect(screen.dx, closeTo(500, 0.001));
  expect(screen.dy, closeTo(400, 0.001));
});
```

Also assert that increasing longitude moves right, increasing latitude moves up, a wrapped longitude near ±180 remains near the camera rather than crossing the whole world, and `projectPoints` returns the same number/order as its input.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter test test/map_camera_projection_test.dart
```

Expected: FAIL because `MapCameraProjection` does not exist yet.

- [ ] **Step 3: Implement the minimal Web Mercator projection**

Implement normalized Web Mercator with a 512-pixel MapLibre world at z0:

```dart
final worldSize = 512 * math.pow(2, zoom).toDouble();
final x = (longitude + 180) / 360;
final y = (1 - math.log(math.tan(latitudeRadians) + 1 / math.cos(latitudeRadians)) / math.pi) / 2;
final screenX = viewport.width / 2 + wrappedDeltaX * worldSize;
final screenY = viewport.height / 2 + (y - cameraY) * worldSize;
```

Clamp latitude to Web Mercator’s finite range and wrap longitude delta to `[-0.5, 0.5]`; do not add bearing or pitch support because the map disables rotation and tilt.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same `flutter test` command. Expected: all projection tests PASS.

- [ ] **Step 5: Integrate projection into `MapCanvas`**

Store the latest `CameraPosition` and viewport size. On every `onCameraMove`, call `projectPoints` for the current marker list and replace `_markerPositions` immediately. Keep `_queueMarkerRefresh` on `onCameraIdle`/`onMapIdle` so `toScreenLocationBatch` corrects the settled frame. Use the existing projection gate to discard stale idle corrections. Add a post-frame viewport-size update so the first camera callback has a usable size.

- [ ] **Step 6: Run the focused map tests and static formatting check**

Run:

```bash
dart format lib/data/map_camera_projection.dart lib/widgets/map_canvas.dart test/map_camera_projection_test.dart
flutter test test/map_camera_projection_test.dart test/map_marker_projection_test.dart
```

Expected: PASS with no formatting changes left unstaged in those files.

No commit is made; leave the task changes in the working tree.

### Task 2: Add coordinate parsing and versioned Taiwan search asset model

**Files:**
- Create: `flutter/lib/data/map_search_asset.dart`
- Modify: `flutter/lib/data/map_search.dart`
- Modify: `flutter/test/map_search_test.dart`
- Create: `flutter/test/map_search_asset_test.dart`

**Interfaces:**
- Produces `TaiwanSearchEntry.fromJson(Map<String, dynamic>)` with `id`, `name`, `aliases`, `kind`, `region`, and `GeoPoint coordinate`.
- Produces `TaiwanSearchAsset.fromJson(Map<String, dynamic>)` validating `schema_version`, `dataset_id`, `snapshot_at`, `source_url`, `source_sha256`, `attribution`, and `entries`.
- Produces `GeoPoint? parseTaiwanCoordinate(String text)` using latitude-first input and Taiwan bounds `119.9–122.2 longitude`, `21.8–25.5 latitude`.
- Extends `MapSearchResult` with nullable `StaticFeature? feature`, `String? region`, and `String? address` so road/coordinate results do not masquerade as facility features.
- Extends `MapSearchIndex` with `MapSearchIndex(List<StaticFeature> features, {Iterable<TaiwanSearchEntry> roadEntries = const []})` and `MapSearchQuery search(String text)`; keep `query(String text)` as a result-list compatibility wrapper for existing callers.

- [ ] **Step 1: Write failing asset, coordinate, and search tests**

Cover:

```dart
test('parses latitude then longitude within Taiwan', () {
  expect(
    parseTaiwanCoordinate('25.011549, 121.545053'),
    const GeoPoint(longitude: 121.545053, latitude: 25.011549),
  );
});

test('rejects coordinates outside Taiwan', () {
  expect(parseTaiwanCoordinate('35.0, 139.0'), isNull);
});

test('preserves two same-name roads in different regions', () {
  final index = MapSearchIndex(const [], roadEntries: <TaiwanSearchEntry>[
    TaiwanSearchEntry.fromJson(<String, dynamic>{
      'id': 'way:1',
      'name': '中山路',
      'aliases': <String>[],
      'kind': 'road',
      'region': '臺北市',
      'coordinate': <double>[121.52, 25.04],
    }),
    TaiwanSearchEntry.fromJson(<String, dynamic>{
      'id': 'way:2',
      'name': '中山路',
      'aliases': <String>[],
      'kind': 'road',
      'region': '高雄市',
      'coordinate': <double>[120.30, 22.63],
    }),
  ]);
  final results = index.query('中山路');
  expect(results.map((item) => item.region), containsAll(<String>['臺北市', '高雄市']));
});
```

Use explicit entries rather than a mock service; the search index must be pure local code.

- [ ] **Step 2: Run the focused tests and verify they fail for missing behavior**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter test test/map_search_test.dart test/map_search_asset_test.dart
```

Expected: FAIL because the asset model/parser and coordinate-aware search API are not implemented.

- [ ] **Step 3: Implement asset validation and coordinate parsing**

Keep numeric JSON values finite, require a two-element coordinate array, preserve `null` only for optional metadata, normalize query text with lowercase/whitespace folding, and reject malformed numeric strings rather than treating them as names.

- [ ] **Step 4: Implement deterministic merged search ranking**

Rank exact name, name prefix, name contains, alias, region, address/detail, kind, and id in that order. Coordinate input returns one `經緯度` result. Road results use `feature: null` and retain region/coordinate metadata. Static facility results preserve their existing `feature` identity and details behavior. Sort ties by source order then stable id and cap results at eight.

- [ ] **Step 5: Run focused tests and the existing search suite**

Run:

```bash
flutter test test/map_search_test.dart test/map_search_asset_test.dart
```

Expected: all old static-feature tests and new asset/parser tests PASS.

- [ ] **Step 6: Refactor only after green**

Extract normalization/ranking helpers only if the focused suite remains green; do not change existing null-preservation semantics.

No commit is made; leave the task changes in the working tree.

### Task 3: Generate and bundle the all-Taiwan road index

**Files:**
- Create: `tools/maps/build_taiwan_search_index.py`
- Create: `tools/maps/test_build_taiwan_search_index.py`
- Create: `tools/maps/testdata/taiwan-roads-fixture.json`
- Create: `tools/maps/requirements-search.txt`
- Create: `flutter/assets/map/search/taiwan-roads.json`
- Modify: `flutter/pubspec.yaml:51-61`
- Modify: `.gitignore`
- Modify: `tools/maps/README.md`
- Test: `flutter/test/map_search_asset_test.dart`

**Interfaces:**
- Command accepts `--input-pbf`, `--source-date`, `--source-url`, `--source-sha256`, and `--output`.
- Command fails nonzero when the PBF is missing, the declared SHA-256 does not match, a named road has no usable coordinate, or output metadata is incomplete.
- Output root contains the metadata and deterministic `entries` shape consumed by `TaiwanSearchAsset`.

- [ ] **Step 1: Add generator contract tests or a deterministic fixture test**

Use a tiny checked-in JSON/GeoJSON fixture under `tools/maps/testdata/` containing two named roads, one unnamed road, one non-road feature, and two same-name regional roads. Run the generator against the fixture through its documented adapter path and assert that only named roads are emitted, coordinates are `[longitude, latitude]`, entries are sorted, and metadata includes the supplied hash.

- [ ] **Step 2: Run the generator test before implementation**

Run:

```bash
python3 -m unittest tools/maps/test_build_taiwan_search_index.py -v
```

Expected: FAIL because the generator and fixture test module do not exist.

- [ ] **Step 3: Implement the generator with a pinned source contract**

Create `tools/maps/requirements-search.txt` with `pyosmium>=4.0,<5`, install it only in the local build environment, and use that environment to read the OSM PBF. Select named `highway` ways, prefer `name:zh-Hant` then `name` then `ref`, derive a representative midpoint from the way geometry, preserve region tags when available, normalize aliases, deduplicate by normalized name/region/stable source id, sort by `(name, region, id)`, and write compact UTF-8 JSON. The generator must compute the input SHA-256 itself and compare it to `--source-sha256` before writing.

- [ ] **Step 4: Run the fixture test and inspect the generated JSON**

Run the focused unit test and then:

```bash
python3 tools/maps/build_taiwan_search_index.py \
  --input-pbf /private/tmp/resilientgeo/taiwan-latest.osm.pbf \
  --source-date 2026-09-22 \
  --source-url https://download.geofabrik.de/asia/taiwan-latest.osm.pbf \
  --source-sha256 "$(shasum -a 256 /private/tmp/resilientgeo/taiwan-latest.osm.pbf | cut -d ' ' -f 1)" \
  --output flutter/assets/map/search/taiwan-roads.json
python3 -m json.tool flutter/assets/map/search/taiwan-roads.json >/dev/null
```

Expected: deterministic JSON with metadata, attribution, and all named Taiwan road entries; no PBF or temporary files are written under tracked paths.

- [ ] **Step 5: Bundle and validate the generated asset**

Add `assets/map/search/taiwan-roads.json` to `pubspec.yaml`, ignore only `.cache`/`.work` search-build intermediates, and extend `map_search_asset_test.dart` to load the real root asset, validate metadata, assert a nonzero entry count, and query a known Taiwan road from the generated file.

- [ ] **Step 6: Update map tooling documentation**

Document the required pinned PBF, SHA-256 verification, build command, output schema, OSM attribution, and the fact that runtime App search never accesses the network or PMTiles directly.

- [ ] **Step 7: Run asset and formatting checks**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter test test/map_search_asset_test.dart
dart format lib/data/map_search_asset.dart test/map_search_asset_test.dart
cd /Users/ray/Desktop/project/OSS
git diff --check
```

Expected: asset load/metadata tests PASS and no whitespace errors.

No commit is made; leave the generated asset and source changes in the working tree.

### Task 4: Integrate offline search and explicit camera requests into `MapScreen`

**Files:**
- Modify: `flutter/lib/screens/map_screen.dart:46-189, 311-381, 441-520`
- Modify: `flutter/lib/widgets/map_canvas.dart:23-65, 118-153, 277-320, 408-428`
- Modify: `flutter/test/map_interaction_test.dart`
- Modify: `flutter/test/map_screen_test.dart`

**Interfaces:**
- `MapScreen` loads `TaiwanSearchAsset` once beside static features and passes the entries into `MapSearchIndex`.
- `MapScreen._selectSearchResult(MapSearchResult)` creates a search camera request and only opens a feature detail sheet when `result.feature != null`.
- `MapScreen._focusCurrentLocation()` preserves the previous valid location on `null`, shows a localized failure message, and increments the camera request id only after a valid `GeoPoint` is returned.
- `MapCanvas` consumes the request id/point and runs only the latest request after style/controller readiness.

- [ ] **Step 1: Add failing interaction tests**

Add a fake `LocationGateway`/`LocationController` test fixture that returns a known Taiwan point and a second fixture that returns `null`. Assert that the successful action produces the current-location marker/focus state, while the failed action preserves existing state and shows the permission message. Add a road-search widget test asserting that selecting a road result does not render a facility detail sheet.

- [ ] **Step 2: Run focused interaction tests and verify failure**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter test test/map_interaction_test.dart test/map_screen_test.dart
```

Expected: FAIL because the screen does not load the Taiwan asset, does not distinguish road results, and silently ignores location failure.

- [ ] **Step 3: Load the asset and merge search sources**

Use `rootBundle.loadString('assets/map/search/taiwan-roads.json')`, parse it through `TaiwanSearchAsset`, and construct one index from static features plus road entries. Keep search results local and synchronous after the asset load.

- [ ] **Step 4: Implement explicit location error and focus behavior**

On a valid location, update `currentLocation`, set the focus point, and increment the request id. On `null`, keep an existing location, leave the camera target untouched, and call `_showMessage('無法取得目前位置，請開啟瀏覽器或裝置定位權限')`. Background stream updates must only update `currentLocation`.

- [ ] **Step 5: Handle search result selection**

For a facility result, preserve current detail behavior. For a road or coordinate result, clear facility/event selection, set focus point and request id, clear the input, and let MapCanvas move the camera without opening an incorrect detail sheet.

- [ ] **Step 6: Run focused interaction tests and the full Flutter test suite**

Run:

```bash
flutter test test/map_interaction_test.dart test/map_screen_test.dart
flutter test
```

Expected: new behavior and all existing tests PASS. If a pre-existing test assumes a missing asset, update only the test fixture to provide the explicit asset loader boundary; do not make production search invent data.

No commit is made; leave the task changes in the working tree.

### Task 5: Integrate Taiwan camera bounds and label-density styles

**Files:**
- Modify: `flutter/lib/data/maplibre_map_config.dart`
- Modify: `flutter/lib/widgets/map_canvas.dart:286-320, 638-670`
- Modify: `flutter/assets/map/styles/taiwan-light.json`
- Modify: `flutter/assets/map/styles/taiwan-dark.json`
- Modify: `flutter/test/maplibre_map_config_test.dart`
- Modify: `flutter/test/map_style_assets_test.dart`
- Modify: `flutter/test/map_provider_test.dart`

**Interfaces:**
- `MapLibreMapConfig` exposes the full Taiwan data bounds, the Taiwan-focused reset bounds, a Taiwan-centered reset camera, `locationZoom`, and the map zoom limits.
- `MapCanvas` keeps `CameraTargetBounds.unbounded` so the user can pan beyond Taiwan, while reset uses the Taiwan-centered fit camera and synchronizes percentage state after overview/zoom camera calls.

- [ ] **Step 1: Add failing camera/style assertions**

Assert that the reset camera targets Taiwan, the reset focus bounds include the main island and intended outlying islands, the full data bounds retain Matsu, max zoom remains 17, camera bounds remain unbounded, both styles keep required local sources/layers, overview places no longer show locality before the agreed threshold, and POI labels start at the high-detail threshold.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter test test/maplibre_map_config_test.dart test/map_style_assets_test.dart test/map_provider_test.dart
```

Expected: FAIL on the old min zoom and old style thresholds.

- [ ] **Step 3: Implement camera configuration**

Keep a safe MapLibre minimum zoom, use a Taiwan-centered fit camera for the reset focus range, leave camera target bounds unbounded so the full data range remains pannable, keep `maxZoom = 17`, and make `_moveToTaiwanOverview` use the same configuration for fit bounds and percentage state. Do not move the camera in layer toggles or marker selection.

- [ ] **Step 4: Update both styles symmetrically**

Split or filter overview place labels so z7.5–9.5 shows only country/region/major city levels, add locality from z9.5–12, retain regional z13–14 places, and reduce non-critical POI labels at z15+ without removing roads/buildings or attribution.

- [ ] **Step 5: Run focused tests and inspect style JSON**

Run the focused test command again, then:

```bash
python3 -m json.tool assets/map/styles/taiwan-light.json >/dev/null
python3 -m json.tool assets/map/styles/taiwan-dark.json >/dev/null
```

Expected: all focused tests PASS and both style files parse successfully.

No commit is made; leave the task changes in the working tree.

### Task 6: Documentation, full verification, and browser/device checks

**Files:**
- Modify: `README.md`
- Modify: `system.md`
- Modify: `tools/maps/README.md`
- Modify: `flutter/test/map_search_asset_test.dart`
- Modify: `flutter/test/map_interaction_test.dart`

**Interfaces:**
- Documentation states the runtime search is local, names the pinned index metadata, records the z15 data ceiling and z17 overzoom, and keeps OSM/Protomaps attribution.

- [ ] **Step 1: Add documentation assertions/checks**

Add static tests or inspection checks that the README/tool documentation mentions `taiwan-roads.json`, local/offline search, attribution, and the z15/z17 boundary without claiming z17 street data exists.

- [ ] **Step 2: Run the complete local verification**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter analyze
flutter test
cd /Users/ray/Desktop/project/OSS
git diff --check
```

Expected: analyze, all Flutter tests, and diff check pass.

- [ ] **Step 3: Run Chrome UI validation**

Run:

```bash
cd /Users/ray/Desktop/project/OSS/flutter
flutter run -d chrome --web-port 8787
```

Exercise the search field with `25.011549, 121.545053` and a Taiwan road name, drag across visible markers, press current location with permission enabled/denied, press default view, use layer controls, and verify the map does not move for layer toggles or marker detail taps. Capture a screenshot for the final handoff if the browser is available.

- [ ] **Step 4: Run Android offline validation when an emulator/device is available**

Enable airplane mode, launch the app, verify PMTiles/search/glyph/sprite assets load, exercise current location and marker drag behavior, and record any platform-only projection or permission issue separately from Flutter test results.

- [ ] **Step 5: Final working-tree handoff**

Report changed files, test commands and outputs, whether the all-Taiwan index was generated from a verified PBF, Chrome/device coverage, and any unverified external state. Do not stage, commit, push, or claim live deployment.
