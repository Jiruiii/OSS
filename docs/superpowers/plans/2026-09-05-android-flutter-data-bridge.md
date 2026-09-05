# Android Flutter Data Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Android-owned Room events and Emergency Mode to the embedded Flutter module through the approved typed platform-channel contract.

**Architecture:** `FlutterMapBridge` owns channel registration and a lifecycle-bound coroutine scope; it delegates Room reads and fixture ingestion to `MeshRepository`, maps complete persisted JSON documents into StandardMessageCodec-safe recursive collections, and delegates service changes to a small Android emergency-mode controller. Dart stays read-only: model classes parse static and dynamic GeoJSON-shaped data while `MapBridge` turns raw channel values into typed method results and event snapshots.

**Tech Stack:** Kotlin, Android Room Flow, Kotlin coroutines, Flutter `MethodChannel`/`EventChannel`, Dart, `flutter_test`, JUnit 4, `org.json`.

**Spec:** `docs/superpowers/plans/2026-09-05-flutter-neihu-map.md` (Task 3), `.superpowers/sdd/2026-09-05-flutter-neihu-map/task-3-brief.md`, and the approved channel contract in the Task 3 request.

## Global Constraints

- Preserve the exact channels `com.resilientgeo.mesh/map` and `com.resilientgeo.mesh/events` and the three approved method names.
- Android is the only Room writer; `loadBundledFixture()` delegates to `MeshRepository.ingestBundledFixture()` and Flutter never accesses the database.
- Event payloads start with each Room row's full `eventJson`, add `apply_state`, and recursively convert `JSONObject`/`JSONArray`/`JSONObject.NULL` into StandardMessageCodec-safe values.
- On EventChannel listen, collect `MeshRepository.observeEvents()`; cancel the collection on cancel and bridge cleanup without leaking a coroutine scope.
- `setEmergencyMode({enabled})` starts/stops the existing `EmergencyModeService`; emergency state is available to `getInitialState()` and survives Flutter reattachment.
- `MainActivity` only registers and closes the bridge. Do not restore the XML screen or touch BLE/transport activities or generated `flutter/.android` files.
- Dart models remain UI-independent; Point, LineString, Polygon, null fields, and expired state are parsed without converting missing data to zero or empty strings.
- Record command output for every RED/GREEN cycle in `.superpowers/sdd/2026-09-05-flutter-neihu-map/task-3-report.md`; commit only Task 3 files with a Conventional Commit subject.

---

### Task 1: Android payload and Emergency Mode seams

**Files:**
- Create: `android/app/src/main/java/com/resilientgeo/mesh/bridge/EventPayloadMapper.kt`
- Create: `android/app/src/main/java/com/resilientgeo/mesh/bridge/EmergencyModeController.kt`
- Test: `android/app/src/test/java/com/resilientgeo/mesh/bridge/EventPayloadMapperTest.kt`
- Test: `android/app/src/test/java/com/resilientgeo/mesh/bridge/EmergencyModeControllerTest.kt`

**Interfaces:**
- Consumes: `EventEntity.eventJson` and `EventEntity.applyState`; existing `EmergencyModeService`.
- Produces: `EventPayloadMapper.toMessage(EventEntity): Map<String, Any?>`; `EmergencyModeController.isEnabled` and `setEnabled(enabled: Boolean): Boolean`.

- [ ] **Step 1: Write failing mapper tests**

```kotlin
@Test fun `maps the full event document recursively and overlays Room apply state`() {
    val mapped = EventPayloadMapper.toMessage(entity)
    assertEquals("official.tdx", mapped["namespace"])
    assertEquals("CURRENT", mapped["apply_state"])
    assertEquals("debris_cleared", (mapped["attributes"] as Map<*, *>)["reason"])
    assertEquals(121.5993, ((mapped["geometry"] as Map<*, *>)["coordinates"] as List<*>)[0].let { (it as List<*>)[0] })
}
```

- [ ] **Step 2: Run mapper test to verify RED**

Run: `cd android && bash ./gradlew testDebugUnitTest --tests com.resilientgeo.mesh.bridge.EventPayloadMapperTest --no-daemon --console=plain`

Expected: FAIL because `EventPayloadMapper` is not defined.

- [ ] **Step 3: Write failing Emergency Mode delegation tests**

```kotlin
@Test fun `enabling starts the foreground-service command and records enabled state`() {
    val command = RecordingEmergencyModeServiceCommand()
    val controller = EmergencyModeController(command, InMemoryEmergencyModeState(false))
    assertTrue(controller.setEnabled(true))
    assertEquals(1, command.starts)
    assertEquals(0, command.stops)
    assertTrue(controller.isEnabled)
}
```

- [ ] **Step 4: Run controller test to verify RED**

Run: `cd android && bash ./gradlew testDebugUnitTest --tests com.resilientgeo.mesh.bridge.EmergencyModeControllerTest --no-daemon --console=plain`

Expected: FAIL because `EmergencyModeController` and its small test seams are not defined.

- [ ] **Step 5: Implement the smallest Android-only seams**

```kotlin
interface EmergencyModeServiceCommand { fun start(); fun stop() }
interface EmergencyModeState { var isEnabled: Boolean }

class EmergencyModeController(
    private val command: EmergencyModeServiceCommand,
    private val state: EmergencyModeState,
) {
    val isEnabled get() = state.isEnabled
    fun setEnabled(enabled: Boolean): Boolean {
        if (enabled) command.start() else command.stop()
        state.isEnabled = enabled
        return enabled
    }
}
```

The Android adapters use `ContextCompat.startForegroundService` / `Context.stopService` for `EmergencyModeService` and `SharedPreferences` for the boolean state. The mapper recursively emits only Kotlin maps, lists, primitives, strings, booleans, and null.

- [ ] **Step 6: Run focused Android tests to verify GREEN**

Run: `cd android && bash ./gradlew testDebugUnitTest --tests com.resilientgeo.mesh.bridge.EventPayloadMapperTest --tests com.resilientgeo.mesh.bridge.EmergencyModeControllerTest --no-daemon --console=plain`

Expected: PASS; assertions confirm full JSON values, Room `apply_state`, nested lists/maps, null conversion, and both service commands.

### Task 2: Kotlin MethodChannel/EventChannel lifecycle bridge

**Files:**
- Create: `android/app/src/main/java/com/resilientgeo/mesh/bridge/FlutterMapBridge.kt`
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/MainActivity.kt`
- Test: `android/app/src/test/java/com/resilientgeo/mesh/bridge/EventPayloadMapperTest.kt` (retain focused codec-shape coverage)

**Interfaces:**
- Consumes: `MeshRepository.observeEvents()`, `MeshRepository.ingestBundledFixture()`, `EventPayloadMapper`, `EmergencyModeController`, and the Flutter engine `BinaryMessenger`.
- Produces: method map `{events: List<Map<String, Any?>>, emergency_mode_enabled: Boolean}`, fixture summary `{processed, inserted, updated, rejected}`, method result `{enabled: Boolean}`, and `EventChannel` snapshots `List<Map<String, Any?>>`.

- [ ] **Step 1: Extend the mapper test with an event-stream-safe snapshot assertion**

```kotlin
@Test fun `message values contain no JSONObject or JSONArray instances`() {
    val mapped = EventPayloadMapper.toMessage(entity)
    assertFalse(containsJsonContainer(mapped))
    assertNull((mapped["attributes"] as Map<*, *>)["missing_value"])
}
```

- [ ] **Step 2: Run the test to verify RED**

Run: `cd android && bash ./gradlew testDebugUnitTest --tests com.resilientgeo.mesh.bridge.EventPayloadMapperTest --no-daemon --console=plain`

Expected: FAIL until recursive null/container conversion is complete.

- [ ] **Step 3: Implement channel registration and cleanup**

```kotlin
class FlutterMapBridge(/* application context, messenger, repository, controller */) {
    fun close() { observationJob?.cancel(); scope.cancel(); methodChannel.setMethodCallHandler(null); eventChannel.setStreamHandler(null) }
    override fun onListen(arguments: Any?, sink: EventChannel.EventSink?) { /* collect observeEvents */ }
    override fun onCancel(arguments: Any?) { observationJob?.cancel(); eventSink = null }
}

override fun configureFlutterEngine(engine: FlutterEngine) {
    super.configureFlutterEngine(engine)
    mapBridge = FlutterMapBridge(applicationContext, engine.dartExecutor.binaryMessenger)
}
```

Methods must return `result.error` for invalid arguments and `result.notImplemented()` for unknown methods. `getInitialState()` obtains events through the repository flow, and fixture ingestion's Room write triggers the already-active EventChannel observer.

- [ ] **Step 4: Run focused Android tests to verify GREEN**

Run: `cd android && bash ./gradlew testDebugUnitTest --tests com.resilientgeo.mesh.bridge.EventPayloadMapperTest --tests com.resilientgeo.mesh.bridge.EmergencyModeControllerTest --no-daemon --console=plain`

Expected: PASS, with the same real nested payload and controller assertions.

### Task 3: UI-independent Dart models and typed bridge

**Files:**
- Create: `flutter/lib/map_models.dart`
- Create: `flutter/lib/map_bridge.dart`
- Test: `flutter/test/map_models_test.dart`

**Interfaces:**
- Consumes: static feature JSON and event maps received from the Android channels.
- Produces: `StaticFeatureCollection`, `StaticFeature`, `MeshEvent`, sealed `MapGeometry` variants, `MapInitialState`, `FixtureLoadSummary`, and `MapBridge` typed methods plus `Stream<List<MeshEvent>>`.

- [ ] **Step 1: Write failing Dart parser tests**

```dart
test('parses a static LineString feature with its exact coordinates', () {
  final feature = StaticFeature.fromJson(lineFeature);
  expect(feature.geometry, isA<LineStringGeometry>());
  expect((feature.geometry! as LineStringGeometry).points.first.longitude, 121.6154878);
  expect(feature.properties, isNull);
});

test('parses Point, LineString, and Polygon event geometries', () { /* assert each subtype and coordinates */ });
test('preserves nullable event fields and flags expired events', () { /* null source/attributes and EXPIRED */ });
```

- [ ] **Step 2: Run Dart tests to verify RED**

Run: `cd flutter && /Users/ray/Development/flutter/bin/flutter test test/map_models_test.dart`

Expected: FAIL because `map_models.dart` does not exist.

- [ ] **Step 3: Implement minimal models and typed channels**

```dart
sealed class MapGeometry { const MapGeometry(); }
final class PointGeometry extends MapGeometry { const PointGeometry(this.point); final GeoPoint point; }
final class LineStringGeometry extends MapGeometry { const LineStringGeometry(this.points); final List<GeoPoint> points; }
final class PolygonGeometry extends MapGeometry { const PolygonGeometry(this.rings); final List<List<GeoPoint>> rings; }

class MapBridge {
  static const methodChannelName = 'com.resilientgeo.mesh/map';
  static const eventChannelName = 'com.resilientgeo.mesh/events';
  Future<MapInitialState> getInitialState();
  Future<FixtureLoadSummary> loadBundledFixture();
  Future<bool> setEmergencyMode({required bool enabled});
  Stream<List<MeshEvent>> get events;
}
```

Cast dynamic channel values defensively to maps/lists, preserve null optional fields, and keep parsing independent of widgets, Room, and asset loading.

- [ ] **Step 4: Run Dart model tests to verify GREEN**

Run: `cd flutter && /Users/ray/Development/flutter/bin/flutter test test/map_models_test.dart`

Expected: PASS with exact Point/LineString/Polygon values, null field preservation, and expired-state assertions.

- [ ] **Step 5: Run scope verification, report, and commit**

Run: `cd flutter && /Users/ray/Development/flutter/bin/flutter analyze`; `cd android && bash ./gradlew testDebugUnitTest --no-daemon --console=plain`; `git diff --check`; inspect `git status --short` and the staged file list.

Write `.superpowers/sdd/2026-09-05-flutter-neihu-map/task-3-report.md` with the exact RED/GREEN commands/results, changed files, known Android baseline environment issue if still present, and self-review result. Commit only the Task 3 files using `feat(bridge): connect Android events to Flutter`.
