# Flutter Crowd Alert and Evacuation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add the Flutter-facing crowd-alert form, typed Android bridge contracts, shelter route actions, route summary state, and MapLibre route-line rendering without claiming that Android route or signing services already exist.

**Architecture:** Flutter owns presentation state and validation. `MapBridge` owns the method-channel contract for Android-owned report creation and offline route calculation; missing native methods are surfaced as an unavailable capability. `MapCanvas` renders a successful route through the same local MapLibre runtime used by the existing offline map, while tests use injected bridge/location implementations and provider-neutral overlay data.

**Tech Stack:** Flutter/Dart 3.7, `flutter_test`, existing `maplibre_gl`, existing `geolocator`, Android `MethodChannel`/`EventChannel` boundary.

**Spec:** User-approved ResilientGeo crowd-alert and offline evacuation-route plan in the current conversation; this execution is limited to Flutter frontend changes.

## Global Constraints

- Android App is the primary route platform; Chrome remains map/data preview and must show unavailable capabilities rather than fake success.
- No Google Maps, online geocoder, online routing API, or network fallback.
- Crowd reports are presented as `UNVERIFIED` and `PENDING` after a successful Android bridge response.
- `available_count == null` remains `無資料`; it must never be displayed as zero.
- Unverified crowd events produce route warnings and do not automatically block the route.
- Do not modify Android, pipeline, schemas, map assets, or existing unrelated worktree changes in this plan.
- Do not stage, commit, merge, or push changes.

## Review Focus

- Missing Android channel methods: the UI must report unavailable capability and must not show a successful submission or route.
- Malformed channel responses: typed parsers must reject missing or invalid fields instead of silently producing a route.
- Missing current location or a shelter without point geometry/id: the user must receive an actionable message.
- `UNVERIFIED` event updates after route calculation: the route must become stale and require recalculation.
- Nullable shelter availability and failed/no-route statuses: the UI must preserve truth and explain the next action.

### Task 1: Add typed crowd-report and route models

**Files:**
- Create: `flutter/lib/data/evacuation_models.dart`
- Create: `flutter/lib/data/crowd_report_models.dart`
- Test: `flutter/test/feature_models_test.dart`

**Interfaces:**
- Produces `CrowdReportCategory`, `CrowdReportDraft`, and `CrowdReportSubmission` for the report form and bridge.
- Produces `EvacuationRouteResult`, `RouteWarning`, and route status strings for bridge, screen, and MapLibre overlay code.
- Preserves coordinate order as `[longitude, latitude]`.

- [ ] Write tests for category wire values/labels, 160-character validation, report response parsing, successful route parsing, warning parsing, and invalid route payload rejection.
- [ ] Run `flutter test test/feature_models_test.dart`; verify the new tests fail because the models do not exist.
- [ ] Implement the smallest immutable models and parsers with explicit validation for required response fields.
- [ ] Run the focused test file, then `flutter test`; verify all tests pass.

### Task 2: Extend the Flutter Android bridge contract

**Files:**
- Modify: `flutter/lib/data/map_bridge.dart`
- Test: `flutter/test/map_models_test.dart`

**Interfaces:**
- Add `submitCrowdReport(CrowdReportDraft draft) -> Future<CrowdReportSubmission>` using method `submitCrowdReport`.
- Add `calculateEvacuationRoute({required GeoPoint origin, required String destinationId, required GeoPoint destination, String mode = 'walk'}) -> Future<EvacuationRouteResult>` using method `calculateEvacuationRoute`.
- Use existing `com.resilientgeo.mesh/map` channel and existing required-map error behavior.

- [ ] Add mock-channel tests for exact report arguments, `UNVERIFIED`/`PENDING` response parsing, route arguments, and malformed response rejection.
- [ ] Run the focused tests and verify they fail before adding the bridge methods.
- [ ] Implement bridge methods without adding fallback calculations or local fake success.
- [ ] Run `flutter test test/map_models_test.dart`; verify existing bridge tests and new tests pass.

### Task 3: Build the crowd-alert form and map location-picking flow

**Files:**
- Create: `flutter/lib/widgets/crowd_report_sheet.dart`
- Modify: `flutter/lib/widgets/map_canvas.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Test: `flutter/test/map_interaction_test.dart`

**Interfaces:**
- The form accepts an initial `CrowdReportDraft`, exposes fixed category selection, description editing, current-location action, map-pick action, and submit/cancel callbacks.
- `MapCanvas` gets an optional coordinate-tap callback that can consume a tap while report location-picking mode is active; normal marker/details behavior remains unchanged otherwise.
- `MapScreen` calls `MapBridge.submitCrowdReport`, shows `未驗證／待同步`, and displays an Android-host-unavailable message on channel failure.

- [ ] Add widget tests for opening the report form, fixed categories, 160-character limit, missing location validation, current-location fallback, map-pick round trip, and successful `UNVERIFIED`/`PENDING` result.
- [ ] Run the focused widget tests and verify they fail before adding the form/integration.
- [ ] Implement the sheet, report draft preservation while selecting a map point, and an accessible map action labelled `回報告警`.
- [ ] Keep report submission asynchronous with a progress state and prevent duplicate submissions.
- [ ] Run `flutter test test/map_interaction_test.dart`; verify all report tests pass with existing map interactions.

### Task 4: Add route overlay and shelter route actions

**Files:**
- Modify: `flutter/lib/data/maplibre_overlay.dart`
- Modify: `flutter/lib/widgets/map_canvas.dart`
- Modify: `flutter/lib/widgets/feature_details_sheet.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Test: `flutter/test/maplibre_overlay_test.dart`, `flutter/test/map_interaction_test.dart`

**Interfaces:**
- Add `MapLibreOverlayData.routeFeatureCollection(EvacuationRouteResult?)`, returning an empty feature collection unless status is `ok` with at least two points.
- `MapCanvas` accepts an optional route result and maintains a local runtime source/layer for the route line; source failure must not hide the map or route summary.
- Shelter detail exposes `規劃逃生路線` only when the parent supplies an action.

- [ ] Add overlay tests for coordinate order, empty/non-OK results, and route feature properties.
- [ ] Add widget tests for the shelter route action and route summary/warning display.
- [ ] Run focused tests and verify the new assertions fail before implementation.
- [ ] Implement the route source/layer using existing MapLibre runtime conventions and render a provider-neutral preview summary in Flutter tests.
- [ ] Keep route warnings visible, especially `UNVERIFIED` warnings; never recolor or silently remove them.
- [ ] Run the focused tests and the complete Flutter suite.

### Task 5: Add nearest-shelter suggestion, stale-route state, and final verification

**Files:**
- Modify: `flutter/lib/screens/map_screen.dart`
- Modify: `flutter/lib/widgets/feature_details_sheet.dart`
- Test: `flutter/test/map_interaction_test.dart`, `flutter/test/map_screen_test.dart`

**Interfaces:**
- Add an accessible `推薦最近避難所` action that requires current location, filters shelter point features, chooses the nearest straight-line candidate, and opens its details; actual route feasibility remains determined by the Android route call.
- Store route destination, route result, loading/error state, and stale state in `MapScreen`.
- Any event snapshot update after a route is shown marks the route stale and provides `重新計算`.

- [ ] Add tests for nearest-shelter selection, no current location, no shelter candidates, `no_route`, `graph_unavailable`, event-update staleness, and `available_count: null` display.
- [ ] Run the focused tests and verify they fail before implementation.
- [ ] Implement state transitions and user messages without adding client-side A* or straight-line fallback.
- [ ] Run `flutter analyze` and `flutter test`; inspect changed-file diff with `git diff --check` while excluding unrelated LFS status failures.
- [ ] Record the final verification results and leave all changes unstaged in the working tree.

