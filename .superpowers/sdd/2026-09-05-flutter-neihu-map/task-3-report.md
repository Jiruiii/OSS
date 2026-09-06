# Task 3 report — IMPLEMENTED_WITH_ANDROID_ENVIRONMENT_BLOCKER

## Scope and implementation

Task 3 adds the approved Android ↔ Flutter data bridge only. It does not add
the map screen/widgets, restore the former XML activity, alter Room ingest
rules, or modify BLE/transport activities or generated `flutter/.android`.

### Android

- `FlutterMapBridge` registers the exact `MethodChannel`
  `com.resilientgeo.mesh/map` and `EventChannel`
  `com.resilientgeo.mesh/events`.
- `getInitialState()` reads the existing `MeshRepository.observeEvents()`
  Flow and returns `{events, emergency_mode_enabled}`. Each event starts with
  the full persisted `EventEntity.eventJson` document and overlays Room's
  `apply_state`.
- `loadBundledFixture()` calls the existing
  `MeshRepository.ingestBundledFixture()` and returns the serializable summary
  `{processed, inserted, updated, rejected}`. The active Room Flow observer
  publishes the resulting snapshot to the EventChannel.
- `setEmergencyMode({enabled: bool})` delegates to the existing
  `EmergencyModeService` through `ContextCompat.startForegroundService` or
  `Context.stopService`. The explicit state is held in `SharedPreferences`, so
  a Flutter reattachment can obtain it from `getInitialState()`.
- `EventPayloadMapper` recursively converts `JSONObject`, `JSONArray`, and
  `JSONObject.NULL` into only StandardMessageCodec-safe Kotlin maps, lists,
  primitives, and null. It never sends an `org.json` container to Flutter.
- Event collection begins only from `EventChannel.onListen`; it is cancelled
  by `onCancel()` and `close()`. `MainActivity` owns only bridge registration
  in `configureFlutterEngine` and bridge cleanup in `onDestroy()`.

### Flutter

- `map_models.dart` is UI-independent and parses static features plus event
  Point, LineString, and Polygon geometries. Nullable contract fields stay
  nullable; `MeshEvent.isExpired` uses Android's persisted `EXPIRED` apply
  state while raw `expires_at` remains display data.
- `map_bridge.dart` exposes typed `getInitialState`, `loadBundledFixture`,
  `setEmergencyMode`, and event-snapshot APIs. It has no database or Android
  storage access.

## TDD evidence

### RED

- `/Users/ray/Development/flutter/bin/flutter test test/map_models_test.dart`
  failed before production source existed. The first error was
  `Error when reading 'lib/map_models.dart': No such file or directory`, then
  the expected missing `StaticFeature`, `MeshEvent`, and geometry types.
- `bash ./gradlew testDebugUnitTest --tests
  com.resilientgeo.mesh.bridge.EventPayloadMapperTest --tests
  com.resilientgeo.mesh.bridge.EmergencyModeControllerTest --no-daemon
  --console=plain` could not reach Kotlin test compilation. It failed in the
  Flutter SDK plugin at `flutter.groovy:9`, before Task 3 sources/tests were
  loaded: `unable to resolve class groovy.xml.QName`.

### GREEN

- The focused Flutter command above passed after implementation: 3/3 tests.
  It asserts exact LineString coordinates, Point/LineString/Polygon concrete
  types and values, nullable event fields, and `EXPIRED` state.
- Android GREEN evidence is unavailable: each retry stops at the same
  pre-source Flutter Gradle plugin compile failure. The Android tests are
  present and assert actual nested JSON values, Room `apply_state`, null
  conversion/no JSON containers, and exact service start/stop counts, but the
  Gradle environment did not compile or execute them.

## Verification

- `/Users/ray/Development/flutter/bin/flutter analyze`: passed — `No issues
  found!`.
- `/Users/ray/Development/flutter/bin/flutter test`: passed — 3/3 tests.
- `dart format --output=none --set-exit-if-changed lib/map_models.dart
  lib/map_bridge.dart test/map_models_test.dart`: passed — 0 files changed.
- `git diff --check`: passed.
- Android focused test command: failed before Task 3 compilation, as detailed
  above. Diagnosis: `bash ./gradlew --version` reports Gradle 9.5.0 / Groovy
  4.0.29; Flutter's SDK plugin imports `groovy.xml.QName` at line 9, and the
  needed Groovy XML module is absent from the local Gradle cache. Android
  settings/build/wrapper files have no changes since Task 1 (`4683d19`), so
  this is not attributable to Task 3 source. Per instruction, the Gradle or
  generated Flutter integration was not changed.

## Self-review

- Channel names, method names, parameter shape, initial-state keys, summary
  keys, and all required event fields match the approved contract.
- Flutter has no Room writes or direct database access; Android uses the
  existing repository ingestion/observation paths.
- MainActivity contains only Flutter bridge lifecycle wiring; no BLE,
  transport, trust, or XML UI logic moved into it.
- The bridge cancels the observation Job, detaches both channel handlers, and
  cancels its coroutine scope during cleanup.
- Event payload values cannot contain `JSONObject` or `JSONArray`; the Android
  mapper test checks this recursively.

## Files changed

- `android/app/src/main/java/com/resilientgeo/mesh/MainActivity.kt`
- `android/app/src/main/java/com/resilientgeo/mesh/bridge/EventPayloadMapper.kt`
- `android/app/src/main/java/com/resilientgeo/mesh/bridge/EmergencyModeController.kt`
- `android/app/src/main/java/com/resilientgeo/mesh/bridge/FlutterMapBridge.kt`
- `android/app/src/test/java/com/resilientgeo/mesh/bridge/EventPayloadMapperTest.kt`
- `android/app/src/test/java/com/resilientgeo/mesh/bridge/EmergencyModeControllerTest.kt`
- `flutter/lib/data/map_models.dart`
- `flutter/lib/data/map_bridge.dart`
- `flutter/test/map_models_test.dart`
- `docs/superpowers/plans/2026-09-05-android-flutter-data-bridge.md`
- `.superpowers/sdd/2026-09-05-flutter-neihu-map/task-3-report.md`

## Reviewer fix report

### Changes

- Moved the Dart data boundary to `flutter/lib/data/`; the former
  `flutter/lib/map_models.dart` and `flutter/lib/map_bridge.dart` paths were
  removed, so there are no duplicate source copies.
- `MeshEvent.isExpired` now returns true only when Android supplied
  `apply_state == "EXPIRED"`. It no longer re-evaluates `expires_at` against
  the Flutter device clock.
- `StaticFeature.fields` retains every non-structural root value from Task 2,
  including `name`, `address`, `capacity`, `available_count`,
  `disaster_types`, and `facility_type`; JSON null remains null. `details`
  merges optional nested `properties` with root fields taking precedence.
- `MapBridge` rejects non-map method replies and missing/invalid required
  fields with `FormatException`; it no longer converts malformed initial,
  summary, or Emergency Mode replies to empty data or false.
- Added `MapBridgeProtocol` and a pure JUnit contract test for the three
  MethodChannel reply payloads plus the EventChannel snapshot payload.
  `FlutterMapBridge` now delegates both reply and snapshot construction to
  that tested protocol helper.

### TDD and verification

- Flutter RED: the updated parser/bridge test first failed because
  `StaticFeature.fields`/`details` did not exist. The final emergency reply
  test also failed against the old fallback with `emitted <false>` instead of
  `FormatException`.
- Flutter GREEN:
  `/Users/ray/Development/flutter/bin/flutter test test/map_models_test.dart`
  passed 9/9. Coverage includes authoritative Android expiry state, the real
  `shelter:5427` root shape and nullable availability, and malformed
  `getInitialState`, fixture-summary, and `setEmergencyMode` replies.
- Android focused protocol test:
  `bash ./gradlew testDebugUnitTest --tests
  com.resilientgeo.mesh.bridge.MapBridgeProtocolTest --no-daemon
  --console=plain` still fails before Kotlin compilation at the existing
  Flutter SDK plugin `flutter.groovy:9` / `groovy.xml.QName` error. No
  Gradle, generated `.android`, or Flutter SDK integration files were changed.

### Reviewer fix files

- `android/app/src/main/java/com/resilientgeo/mesh/bridge/MapBridgeProtocol.kt`
- `android/app/src/test/java/com/resilientgeo/mesh/bridge/MapBridgeProtocolTest.kt`
- `android/app/src/main/java/com/resilientgeo/mesh/bridge/FlutterMapBridge.kt`
- `flutter/lib/data/map_models.dart`
- `flutter/lib/data/map_bridge.dart`
- `flutter/test/map_models_test.dart`
- `docs/superpowers/plans/2026-09-05-android-flutter-data-bridge.md`
- `.superpowers/sdd/2026-09-05-flutter-neihu-map/task-3-report.md`
