# Flutter Crowd Alert and Evacuation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Flutter-only citizen alert reporting flow and offline evacuation-route presentation while treating Android as the only authority for report persistence/signing and route calculation.

**Architecture:** `MapScreen` remains the coordinator. Typed models isolate channel validation, focused widgets render forms/results, and `MapCanvas` only renders routes returned by Android. Flutter may collect location and shortlist shelters, but must never sign/store a report, calculate a route, or display a straight line as a route.

**Tech Stack:** Flutter/Dart 3.7, `flutter_test`, existing `maplibre_gl` 0.27.1, existing `geolocator` 13.0.2, Android MethodChannel/EventChannel boundary.

**Spec:** The user-approved flow represented by `docs/mock/resilientgeo-feature-preview.html`, narrowed to Flutter frontend changes plus the Flutter-to-Android API contract below.

## Global Constraints

- Implementation scope is limited to `flutter/lib/` and `flutter/test/`; this document is planning only.
- Do not modify Android, Room, signing, Peer Sync, graph assets, pipeline schemas, or shelter source data.
- Android alone signs/stores crowd reports and calculates walking routes.
- Chrome and missing Android methods show a limitation; neither condition may produce fake success.
- Do not use Google Maps, online geocoding/routing, network fallback, or a straight-line route.
- Address input is resolved only against bundled area, road, facility, and coordinate indexes; area/road results are approximate hints that must be refined with the map center pin.
- Report success requires exactly `apply_state: UNVERIFIED` and `delivery_state: PENDING`.
- `UNVERIFIED` alerts remain warnings; Flutter must not convert them into blocked roads.
- `available_count == null` remains `無資料`, never `0`.
- Channel maps use `{lon, lat}`; route polylines use `[lon, lat]`.
- Preserve search, location, feature/event selection, accessibility, and offline-map behavior.
- Leave implementation changes unstaged; do not add, commit, merge, or push unless separately requested.

## Current Frontend and Planned Files

Current ownership:

- `flutter/lib/screens/map_screen.dart`: location, event subscription, selection, map UI state.
- `flutter/lib/data/map_bridge.dart`: `com.resilientgeo.mesh/map` and `com.resilientgeo.mesh/events`.
- `flutter/lib/widgets/map_canvas.dart`: MapLibre runtime sources/layers.
- `flutter/lib/widgets/feature_details_sheet.dart`: shelter details and nullable occupancy.
- `flutter/lib/data/location_controller.dart`: explicit location requests with prior-location preservation.

Planned files:

- Create `flutter/lib/data/crowd_report_models.dart` for report category, validation, serialization, and submission parsing.
- Create `flutter/lib/data/evacuation_models.dart` for route status, warning, result, and shelter candidate.
- Create `flutter/lib/data/bridge_failure.dart` for normalized bridge failures.
- Modify `flutter/lib/data/map_bridge.dart` with two typed native calls.
- Create `flutter/lib/widgets/crowd_report_sheet.dart` and `flutter/lib/widgets/evacuation_route_sheet.dart`.
- Modify `flutter/lib/widgets/feature_details_sheet.dart`, `flutter/lib/data/maplibre_overlay.dart`, `flutter/lib/widgets/map_canvas.dart`, and `flutter/lib/screens/map_screen.dart`.
- Add focused tests under `flutter/test/`.

## Flutter-to-Android API Contract

### Channels

```text
MethodChannel: com.resilientgeo.mesh/map
EventChannel:  com.resilientgeo.mesh/events
Codec:         StandardMessageCodec-compatible maps/lists/primitives
```

The existing EventChannel continues to emit a complete `List<MeshEvent>` snapshot. Flutter shows submission state immediately, but adds a marker only when the persisted report appears through the EventChannel. It must not fabricate a `MeshEvent` from the submission response.

### `submitCrowdReport`

Request:

```json
{
  "category": "ROAD_BLOCKAGE",
  "location": {
    "lon": 121.590304,
    "lat": 25.083506,
    "source": "CURRENT_LOCATION"
  },
  "location_hint": {
    "method": "ADDRESS",
    "query": "內湖區成功路",
    "label": "成功路",
    "kind": "ROAD",
    "precision": "ROAD"
  },
  "description": "道路有落石，請注意通行安全"
}
```

| Wire value | Flutter label |
| --- | --- |
| `ROAD_BLOCKAGE` | 道路阻斷 |
| `FLOOD` | 淹水 |
| `FIRE_SMOKE` | 火災／煙霧 |
| `TRAPPED_INJURED` | 受困／受傷 |
| `OTHER` | 其他 |

`location.source` is `CURRENT_LOCATION` or `MAP_PICK`. `MAP_PICK` means the final coordinate was confirmed from the map center pin, including an address-assisted search followed by manual dragging. `location_hint` is optional display/provenance context from the local search index; it is not an authoritative geocoded address and must not replace the final `lon`/`lat`. Its `method` is `ADDRESS`, `kind` is `COUNTY`, `DISTRICT`, `VILLAGE`, `ROAD`, or `FACILITY`, and `precision` is `AREA`, `ROAD`, or `POINT`. Longitude is -180...180 and latitude is -90...90. Description may be empty and is at most 160 user-perceived characters after trimming surrounding whitespace.

Success response:

```json
{
  "event_id": "report:550e8400-e29b-41d4-a716-446655440000",
  "apply_state": "UNVERIFIED",
  "delivery_state": "PENDING"
}
```

Flutter accepts success only when `event_id` is non-empty and begins with `report:`, `apply_state` equals `UNVERIFIED`, and `delivery_state` equals `PENDING`. Any other response is a contract error and must not show success.

### `calculateEvacuationRoute`

Request:

```json
{
  "origin": {"lon": 121.590304, "lat": 25.083506},
  "destination": {
    "id": "shelter:5427",
    "lon": 121.5908,
    "lat": 25.0609
  },
  "mode": "walk"
}
```

Success response:

```json
{
  "status": "ok",
  "polyline": [
    [121.590304, 25.083506],
    [121.590521, 25.079100],
    [121.590800, 25.060900]
  ],
  "distance_m": 1200,
  "duration_s": 900,
  "graph_version": "taiwan-walk-2026-09-01",
  "event_snapshot_at": "2026-09-25T08:30:00Z",
  "warnings": [
    {
      "code": "UNVERIFIED_CROWD_REPORT",
      "event_id": "report:550e8400-e29b-41d4-a716-446655440000",
      "message": "附近有未驗證告警，請現場確認"
    }
  ],
  "blocked_event_ids": ["road:official-closed-123"]
}
```

Non-success response:

```json
{
  "status": "graph_unavailable",
  "polyline": [],
  "distance_m": null,
  "duration_s": null,
  "graph_version": null,
  "event_snapshot_at": "2026-09-25T08:30:00Z",
  "warnings": [],
  "blocked_event_ids": []
}
```

| Status | Flutter behavior |
| --- | --- |
| `ok` | Render Android polyline and show metrics/version/warnings. |
| `no_route` | Clear old route; show「找不到可達路線」. |
| `graph_unavailable` | Clear old route; show「離線路網尚未載入」. |
| `invalid_input` | Clear old route; show「起點或避難所資料不完整」. |

For `ok`, the polyline has at least two valid points, metrics are finite and non-negative, and graph/snapshot strings are non-empty. For non-success statuses, Flutter ignores supplied polylines and never draws a fallback.

Warnings are display data. `UNVERIFIED_CROWD_REPORT` remains visible and never becomes a blocked edge in Flutter. `blocked_event_ids` is informational and comes only from Android's route snapshot.

### Platform failures

| `PlatformException.code` | Frontend behavior |
| --- | --- |
| `invalid_input` | Input message; no success. |
| `signing_unavailable` | Report signing unavailable. |
| `storage_unavailable` | Report could not enter outbox. |
| `graph_unavailable` | Offline graph unavailable. |
| `route_engine_error` | Calculation failed; retry allowed. |
| `map_bridge_error` | Generic native failure; retry allowed. |

`MissingPluginException`, Chrome host detection, and unrecognized native errors normalize to unavailable/unknown bridge failures. They never construct report success or an `ok` route.

## Frontend State Rules

```text
Report: idle -> editing -> addressSearch -> pickingMapLocation -> editing -> confirming
        editing -> pickingMapLocation -> editing -> confirming
        -> submitting -> submitted(UNVERIFIED, PENDING) -> idle
        submitting -> failure -> confirming

Route:  idle -> calculating(destination) -> ready(route) -> stale(route)
        calculating -> noRoute | graphUnavailable | invalidInput | bridgeUnavailable
        ready/stale -> calculating | idle
```

- Report draft survives map picking and only one submission can be in flight.
- Selecting an area/road/facility search result moves the map to its bundled representative coordinate and enters center-pin picking; only the user-confirmed center coordinate is submitted.
- Changed EventChannel data after route request start makes the route stale; identical replay does not.
- Stale keeps the old line and shows「路線資訊已變更，請重新計算」.
- Flutter may use straight-line distance only to shortlist at most five point shelters. That value is never displayed or rendered.
- It calls `calculateEvacuationRoute` for each shortlisted shelter and recommends the successful result with the lowest Android `distance_m`.
- `no_route` candidates are skipped. Graph/bridge failure or event update aborts recommendation; there is no straight-line fallback.

## Review Focus

- Malformed report states (`CURRENT/PENDING`, `UNVERIFIED/SENT`, missing event id) must not look successful.
- Chrome, missing plugin, and native failures must not create local reports or routes.
- An `ok` route with invalid points, negative metrics, or missing version/snapshot must be rejected.
- Identical event replay must not stale a route; changed id/version must stale it even during calculation.
- Recommendation must rank Android route distance only and never expose Flutter shortlist distance.

---

### Task 1: Add typed report and route contracts

**Files:**

- Create: `flutter/lib/data/crowd_report_models.dart`
- Create: `flutter/lib/data/evacuation_models.dart`
- Create: `flutter/lib/data/bridge_failure.dart`
- Test: `flutter/test/crowd_report_models_test.dart`
- Test: `flutter/test/evacuation_models_test.dart`

**Interfaces:** Produces `CrowdReportCategory`, `CrowdReportLocationSource`, `CrowdReportDraft`, `CrowdReportSubmission`, `EvacuationRouteStatus`, `RouteWarning`, `ShelterRouteCandidate`, `EvacuationRouteResult`, `BridgeFailureCode`, and `BridgeFailure`.

- [ ] Write failing report tests for five wire values/labels, empty description, 160/161-character boundaries, coordinate validation, serialization, and strict `UNVERIFIED/PENDING` parsing.
- [ ] Run `cd flutter && /Users/ray/Development/flutter/bin/flutter test test/crowd_report_models_test.dart`; expect compilation failure because types do not exist.
- [ ] Implement these public shapes:

```dart
enum CrowdReportCategory { roadBlockage, flood, fireSmoke, trappedInjured, other }
enum CrowdReportLocationSource { currentLocation, mapPick }

final class CrowdReportDraft {
  const CrowdReportDraft({required this.category, required this.location,
    required this.locationSource, required this.description});
  final CrowdReportCategory category;
  final GeoPoint? location;
  final CrowdReportLocationSource? locationSource;
  final String description;
  String? validate();
  Map<String, Object?> toChannelArguments();
}

final class CrowdReportSubmission {
  factory CrowdReportSubmission.fromMessage(Map<String, dynamic> message);
}

enum EvacuationRouteStatus { ok, noRoute, graphUnavailable, invalidInput }

final class ShelterRouteCandidate {
  const ShelterRouteCandidate({required this.id, required this.location});
  final String id;
  final GeoPoint location;
}

final class EvacuationRouteResult {
  factory EvacuationRouteResult.fromMessage(Map<String, dynamic> message);
}
```

- [ ] Write failing route tests for all statuses, `[lon, lat]` order, warnings, non-success polyline suppression, and malformed `ok` rejection.
- [ ] Implement `RouteWarning` plus bridge failure codes `unavailable`, `invalidInput`, `signingUnavailable`, `storageUnavailable`, `graphUnavailable`, `routeEngineError`, and `unknown`.
- [ ] Run both focused model suites; expect all tests to pass.

### Task 2: Extend the MethodChannel bridge without fallback data

**Files:**

- Modify: `flutter/lib/data/map_bridge.dart`
- Create: `flutter/test/map_bridge_feature_contract_test.dart`

**Interfaces:** Consumes Task 1 models and produces two typed native calls.

- [ ] Write failing tests that capture exact method names/maps for `submitCrowdReport` and `calculateEvacuationRoute`.
- [ ] Test non-map/malformed responses, known platform codes, missing plugin, and unknown codes.
- [ ] Run the focused test; expect failure because methods do not exist.
- [ ] Add exact signatures:

```dart
Future<CrowdReportSubmission> submitCrowdReport(CrowdReportDraft draft);

Future<EvacuationRouteResult> calculateEvacuationRoute({
  required GeoPoint origin,
  required ShelterRouteCandidate destination,
  String mode = 'walk',
});
```

- [ ] Use only the existing MethodChannel and normalize errors without synthetic results.
- [ ] Run `flutter test test/map_bridge_feature_contract_test.dart test/map_models_test.dart`; expect all tests to pass.

### Task 3: Build the report form and confirmation widget

**Files:**

- Create: `flutter/lib/widgets/crowd_report_sheet.dart`
- Create: `flutter/test/crowd_report_sheet_test.dart`

**Interfaces:** Pure presentation receives a draft and callbacks; it does not access bridge or location services.

- [ ] Write failing widget tests for five categories, 160-character formatter/counter, current-location/map-pick actions, missing-location validation, empty description, and confirmation details.
- [ ] Test that back-navigation preserves the draft and submission state disables duplicate taps.
- [ ] Run the focused test; expect missing-widget failure.
- [ ] Implement:

```dart
enum CrowdReportSheetStep { edit, confirm }

class CrowdReportSheet extends StatelessWidget {
  const CrowdReportSheet({
    super.key,
    required this.draft,
    required this.step,
    required this.submitting,
    required this.onDraftChanged,
    required this.onRequestCurrentLocation,
    required this.onRequestMapPick,
    required this.onShowConfirmation,
    required this.onBackToEdit,
    required this.onSubmit,
    required this.onCancel,
  });
}
```

- [ ] Run `flutter test test/crowd_report_sheet_test.dart`; expect all tests to pass.

### Task 4: Integrate report map-picking and honest submission states

**Files:**

- Modify: `flutter/lib/widgets/map_canvas.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Create: `flutter/test/crowd_report_flow_test.dart`

**Interfaces:**

- `MapCanvas` adds `ValueChanged<GeoPoint>? onCoordinatePicked`.
- `MapScreen` owns draft, form step, map-pick mode, in-flight state, and result.
- New map action semantic label is `回報告警`.

- [ ] Write failing end-to-end widget tests for current-location submission, map-pick round trip, location failure, bridge unavailable, signing/storage error, duplicate tap, and no fabricated marker.
- [ ] Run the focused test; expect report-flow failures.
- [ ] In map-pick mode, convert MapLibre `LatLng` to `GeoPoint`, call `onCoordinatePicked`, and consume the tap before normal marker/event selection.
- [ ] In `MapScreen`, preserve the draft while picking, submit only after confirmation, accept only strict parsed success, and show `告警已建立：未驗證／待同步` plus event id.
- [ ] Map an unavailable bridge to `此功能需要 Android App，Chrome 僅供地圖與資料預覽`; never show success on any failure.
- [ ] Run `flutter test test/crowd_report_flow_test.dart test/map_interaction_test.dart test/map_screen_test.dart`; expect all tests to pass, including prior-location preservation.

### Task 5: Add route overlay and route summary presentation

**Files:**

- Modify: `flutter/lib/data/maplibre_overlay.dart`
- Modify: `flutter/lib/widgets/map_canvas.dart`
- Create: `flutter/lib/widgets/evacuation_route_sheet.dart`
- Modify: `flutter/lib/widgets/feature_details_sheet.dart`
- Create: `flutter/test/evacuation_route_sheet_test.dart`
- Modify: `flutter/test/maplibre_overlay_test.dart`

**Interfaces:**

- `routeFeatureCollection(EvacuationRouteResult?)` returns empty GeoJSON unless status is valid `ok`.
- `MapCanvas` accepts `EvacuationRouteResult? route` and manages one non-interactive route source/layer.
- `FeatureDetailsSheet.feature` accepts optional `onPlanEvacuationRoute` and shows it only for shelters.
- `EvacuationRouteSheet` remains presentation-only.

- [ ] Write failing GeoJSON tests for exact coordinate order and empty results for null/non-OK routes.
- [ ] Write failing route-sheet tests for loading; metres/kilometres; rounded-up minutes; graph version; snapshot; warnings; blocked ids; every error state; stale text; recalculation.
- [ ] Run focused tests; expect missing route APIs/widgets.
- [ ] Add MapLibre source/layer ids `app-evacuation-route` and `app-evacuation-route-line`; create after style load and update on route changes. Layer failure must not hide map/summary.
- [ ] Add `規劃逃生路線` below shelter metadata without changing `收容人數：無資料` behavior.
- [ ] Run `flutter test test/maplibre_overlay_test.dart test/evacuation_route_sheet_test.dart test/map_interaction_test.dart`; expect all tests to pass.

### Task 6: Integrate route calculation and event staleness

**Files:**

- Modify: `flutter/lib/screens/map_screen.dart`
- Create: `flutter/test/evacuation_route_flow_test.dart`

**Interfaces:**

- `MapScreen` stores destination, request token, result/failure, event fingerprint at request start, and stale flag.
- Fingerprint is based on sorted `meshEventIdentity` values, so order-only updates are identical.

- [ ] Write failing flow tests for route action, location request/failure, invalid shelter, exact bridge arguments, all route statuses, bridge unavailable, visible UNVERIFIED warnings, and no fallback line.
- [ ] Write failing timing tests: identical replay stays ready; changed id/version becomes stale; an in-flight event change makes the returned route stale; recalculate reuses destination; an older async response is ignored.
- [ ] Run the focused test; expect route-orchestration failures.
- [ ] Implement one entry point:

```dart
Future<void> _calculateRouteTo(StaticFeature shelter)
```

- [ ] Validate current location and point shelter, capture fingerprint/token, call Android, ignore obsolete results, and render only parsed `ok` output.
- [ ] Compare event fingerprints before replacing `_persistedEvents`; changed data marks the route stale and shows `路線資訊已變更，請重新計算`.
- [ ] Run `flutter test test/evacuation_route_flow_test.dart test/map_interaction_test.dart test/map_screen_test.dart`; expect all tests to pass.

### Task 7: Add nearest reachable shelter recommendation

**Files:**

- Modify: `flutter/lib/data/evacuation_models.dart`
- Modify: `flutter/lib/screens/map_screen.dart`
- Modify: `flutter/test/evacuation_models_test.dart`
- Modify: `flutter/test/evacuation_route_flow_test.dart`

**Interfaces:**

- `shortlistShelterCandidates(origin, shelters, limit: 5)` returns candidates only, never straight-line metrics.
- New semantic action is `推薦最近避難所`.
- Ranking uses Android-returned `distance_m` only.

- [ ] Write failing unit tests: only shelters with id/Point qualify; shortlist is deterministic by air distance then id; maximum five; no distances escape the helper.
- [ ] Write failing flow tests: location acquisition, no shelters, bounded Android calls, mixed OK/no-route ranking, all no-route, graph/bridge abort, event-change abort, and no interim/fake line.
- [ ] Run the two focused suites; expect recommendation failures.
- [ ] Sequentially call Android for up to five candidates, show progress such as `正在比較可達避難所（2/5）`, skip `no_route`, and select the lowest successful Android distance.
- [ ] Open the selected shelter and show only its Android-returned route. Abort on graph/bridge failure or changed event fingerprint; never choose by straight-line distance as fallback.
- [ ] Run `flutter test test/evacuation_models_test.dart test/evacuation_route_flow_test.dart`; expect all tests to pass.

### Task 8: Final accessibility, web, and regression verification

**Files:**

- Modify only Task 1-7 files if verification reveals a scoped defect.
- Test all files under `flutter/test/`.

- [ ] At 390x844 logical pixels, verify `回報告警`, `推薦最近避難所`, `規劃逃生路線`, and stale `重新計算` remain reachable without overflow.
- [ ] Verify progress states are announced and duplicate submit/calculate actions are disabled.
- [ ] Run formatting check and analyzer:

```bash
cd flutter
/Users/ray/Development/flutter/bin/dart format --output=none --set-exit-if-changed lib test
/Users/ray/Development/flutter/bin/flutter analyze
```

- [ ] Run the complete suite:

```bash
cd flutter
/Users/ray/Development/flutter/bin/flutter test
```

- [ ] Exercise a web target or web widget path: map preview loads, native actions explain Android requirement, and no success/route/metric/fabricated event appears.
- [ ] Check scoped diffs and leave them unstaged:

```bash
git diff --check -- docs/superpowers/plans/2026-09-24-flutter-crowd-alert-evacuation-ui.md flutter/lib flutter/test
git status --short -- docs/superpowers/plans/2026-09-24-flutter-crowd-alert-evacuation-ui.md flutter/lib flutter/test
```

## Acceptance Checklist

- [ ] Exactly five fixed report categories are available.
- [ ] Current location and map-picked location preserve draft data.
- [ ] Description maximum is 160 characters and confirmation is required.
- [ ] Only exact `UNVERIFIED/PENDING` displays「未驗證／待同步」.
- [ ] Chrome/missing bridge/native errors never display fake success.
- [ ] Shelter details include「規劃逃生路線」without changing nullable occupancy.
- [ ] Map screen includes「推薦最近避難所」and ranks Android route results.
- [ ] Flutter never renders a straight-line route fallback.
- [ ] Successful route shows polyline, distance, duration, graph version, event snapshot, warnings, and blocked ids.
- [ ] `UNVERIFIED` warning remains visible and does not suppress a valid route.
- [ ] Changed events require recalculation; identical snapshots do not.
- [ ] Analyzer and complete Flutter test suite pass before completion is claimed.
