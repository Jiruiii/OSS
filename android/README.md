# ResilientGeo Mesh — Android

> 2026-09-06 更新：Android 現在是原生資料與服務的 host，`MainActivity` 直接嵌入 Flutter 內湖地圖。線上且有 key 時使用 Google Maps Android SDK，無網路或無 key 時回退 OSM 離線 tiles。下方較早的 native-only baseline 驗證紀錄仍保留作為歷史證據。

Single Android project, jointly owned:

- **Module B (GIS & 本機資料庫)** — local database, apply rules and Ed25519
  trust adapter. Its verified event state is now consumed by the Flutter map;
  `MainActivity` remains the app's launcher.
- **Module C (Peer Sync & 傳輸層)** — Stage 0 BLE discovery spike
  (`transport/`) and peer-sync harnesses. They remain debug-only native
  activities rather than content on the Flutter map screen. See
  `C_BLEbroadcast.md` at the repo root for C's device-tested findings.

## Current Flutter integration note

`MainActivity` is now a `FlutterFragmentActivity`. The Flutter module is maintained
under `flutter/` and is included as the `:flutter` source-code subproject by
`flutter/.android/include_flutter.groovy`; generated `.android/` files are not
hand-edited. The user-facing surface is `flutter/lib/screens/map_screen.dart`.

The fallback map uses only committed assets: `flutter_map`'s
`AssetTileProvider` loads the versioned Neihu tiles at zoom 12–17. When an
Android-restricted key is supplied at build time and the device has network,
`google_maps_flutter` renders the online Google Maps SDK instead. The snapshot
contains 5,774 OSM road geometries, 26 shelters and 4 medical facilities.
The UI shows zoom as 0–100%: 0% is the full Neihu extent, 100% is the maximum
street detail available from the active provider.

### Google Maps Demo key

Google tiles are not downloaded or cached by this project. For a demo, create
an Android-restricted key in Google Cloud, restrict it by package name
`com.resilientgeo.mesh` and the debug/release SHA-1, then enable Maps SDK for
Android. Put the key in the ignored repository-root `.env` file:

```dotenv
GOOGLE_MAPS_API_KEY=AIza...
```

The Gradle manifest placeholder reads values in this order: the
`GOOGLE_MAPS_API_KEY` environment variable, `android/local.properties`, then
the repository-root `.env`. The Android host bridge checks the resulting
Manifest metadata before enabling Google Maps, so Android Studio `app` runs do
not need a second Dart define. The standalone generated Flutter module host
does not contain this app Manifest and intentionally stays on the OSM fallback.

```bash
cd android
./gradlew assembleDebug
```

If the Android key is omitted, or network is unavailable, the app intentionally
uses the bundled OSM map. The supplied Google Maps JavaScript sample is not
used by this Android Flutter implementation; this app uses
`google_maps_flutter` and the native Android SDK.

Flutter reads native state through `FlutterMapBridge`:

- `com.resilientgeo.mesh/map`: `getInitialState`, `loadBundledFixture` and
  `setEmergencyMode`.
- `com.resilientgeo.mesh/events`: verified Room event snapshots, including
  Android's authoritative `apply_state`.

Room ingestion, signature verification, TTL/version rules, BLE and the
foreground Emergency Mode service remain Android-owned. Flutter is read-only
with respect to Room. Shelter `capacity` means expected capacity; current
occupancy is intentionally unavailable (`available_count: null`) and the UI
shows `無資料`, never zero. Bundled demo events are labeled
`模擬事件，非即時官方災情`.

### Current build result

Flutter static asset validation, Flutter analyze/tests, Android unit tests
(48 tests), and the embedded host `assembleDebug` build pass. The host APK
is produced at `android/app/build/outputs/apk/debug/app-debug.apk` and
contains the committed Neihu static data and zoom-17 tiles. Gradle emits a
non-blocking warning that `path_provider_android` requests NDK
27.0.12077973 while the generated Flutter module declares 26.3.11579264;
the module's generated `.android/` files remain unedited. Device-level
offline restart and marker interaction should still be checked on the target
phone before release.

### 在 Android Studio 查看 Flutter 畫面

1. 用 Android Studio 開啟 `<repo>/android`，不要把 `flutter/.android/`
   當成要編輯的專案。
2. 確認 `android/local.properties` 指向 Android SDK 與 Flutter SDK；這個檔案
   已被 gitignore，不會提交。需要線上 Google 地圖時，建議在 repo 根目錄
   `.env` 加入 `GOOGLE_MAPS_API_KEY`；也可放在此檔案，兩者都不會提交。
3. 啟動 Android Emulator 或連接手機，在 Android Studio 選 `app` 設定並執行
   debug。App 啟動後會直接進入 Flutter 內湖地圖。
4. Flutter 畫面程式在 `flutter/lib/`；要使用 Dart hot reload，可另外在
   Android Studio 安裝 Flutter／Dart plugin，開啟 `flutter/` 編輯，但最終
   整合畫面仍應由 `android` host 的 debug APK 驗證。

This file was rewritten while reconciling two Android projects that were
built independently on separate branches (B built a full Gradle skeleton
from scratch; C built one via Android Studio's project wizard for the BLE
spike). The reconciliation kept **C's** Gradle/AGP/Kotlin toolchain and
resource conventions as the base and ported B's code into it — see
"Reconciliation notes" below for exactly what that involved and the
reasoning behind each judgment call.

## Native-only baseline build status (before Flutter embed)

The following three verification layers were run against the native-only
baseline on a real device. They are historical evidence and do not replace
the current Flutter-host build check described above:

All three verification layers have actually been run against this
branch, on a real device (Pixel 8a, API 36, connected over USB) — not
just assumed from reading the build files:

1. **`./gradlew testDebugUnitTest`** — passes (15 tests: `CanonicalTest`,
   `EventVerifierTest`, `EventIngestorTest` — 0 failures). See "What
   actually broke on first build" below for the real errors fixed to get
   here, since AGP 9.3.2 turned out to have several behaviors nobody
   involved in the original merge could have predicted from reading the
   build files alone.
2. **`./gradlew connectedDebugAndroidTest`** — passes (2 tests,
   `RoomEventStoreInstrumentedTest`, run on the Pixel 8a above).
3. **Manual offline-restart check** — installed via `installDebug`,
   launched, tapped "Load bundled test events"
   (`inserted=4 updated=1 rejected=1`, matching the fixture generator's
   expected outcome exactly), force-stopped, disabled Wi-Fi/mobile data,
   relaunched: map and event list showed the same data **without**
   re-tapping the load button, confirming it's read from Room and not
   re-derived. This is phase 1's actual acceptance criterion
   (`team-assignments.md`) and it holds.

4. **"BLE Spike (Stage 0)" button navigation** — verified on the same
   Pixel 8a. Tapping it correctly starts `BleSpikeActivity`, which
   requests the `NEARBY_DEVICES` runtime permission group
   (`BLUETOOTH_SCAN`/`ADVERTISE`/`CONNECT`), and once Bluetooth itself is
   turned on, logcat shows `ResilientGeoBle: advertise started ok` with
   no `scan failed` error — matching `C_BLEbroadcast.md`'s documented
   behavior exactly. (With Bluetooth off, it logs `no BLE
   advertiser/scanner available on this device` and does nothing else —
   that's the code's existing null-safe fallback, not a bug; see
   `transport/BleDiscovery.kt`.) The merge's manifest/theme changes don't
   break this path.

### Local setup that isn't part of the repo (per-machine)

- `JAVA_HOME` must point at a real JDK 17+. Android Studio bundles one —
  on this machine that was `<Android Studio install dir>/jbr` (find the
  real install dir via `%LOCALAPPDATA%\Google\AndroidStudio*\.home` if
  Android Studio itself was installed somewhere other than
  `Program Files`). `gradle-daemon-jvm.properties` selects JDK 21 for the
  Flutter 3.29.2/Gradle 8.11.1 host combination.
- `android/local.properties` (gitignored, not committed) needs
  `sdk.dir=<path to Android SDK>`. Default location is
  `%LOCALAPPDATA%\Android\Sdk`; Android Studio's own SDK Manager creates
  and manages this.

### Historical native-only build notes

Reading the Gradle files was not enough to predict these — they only
showed up by actually running `./gradlew` against this exact AGP/Kotlin
combination:

1. **`org.jetbrains.kotlin.android` conflicts with AGP's own Kotlin
   support.** This project's AGP version (9.3.2) has a feature called
   "built-in Kotlin": `com.android.application` sets up Kotlin
   compilation itself. Explicitly applying `org.jetbrains.kotlin.android`
   on top of it crashes with `Cannot add extension with name 'kotlin', as
   there is an extension already registered with that name.` An earlier
   pass at this reconciliation had added that plugin, reasoning that C's
   original project was missing it and would therefore fail to compile
   `.kt` files — that reasoning was **wrong**: C's project built and ran
   fine without it (see `C_BLEbroadcast.md`), which in hindsight was the
   evidence that AGP was already handling Kotlin on its own. Fixed by not
   applying `kotlin.android` at all, and dropping the `kotlinOptions { jvmTarget
   = ... }` block from `app/build.gradle.kts` (that DSL comes from the
   Kotlin Android plugin; built-in Kotlin derives its target from
   `compileOptions` instead — confirmed by the `Unresolved reference
   'kotlinOptions'` error once the plugin was removed).
2. **kapt doesn't work with built-in Kotlin either.** AGP's own error is
   explicit: `The 'org.jetbrains.kotlin.kapt' plugin is not compatible
   with built-in Kotlin support... [Recommended] Migrate this project to
   built-in Kotlin.` So Room's annotation processing uses **KSP**
   (`com.google.devtools.ksp` version `2.2.10-2.0.2`, confirmed compatible
   via https://developer.android.com/r/tools/built-in-kotlin), not kapt.
3. **KSP's generated-sources wiring needed a compatibility flag.** With
   KSP applied, AGP still failed: `Using kotlin.sourceSets DSL to add
   Kotlin sources is not allowed with built-in Kotlin... To suppress this
   error, set android.disallowKotlinSourceSets=false in
   gradle.properties.` This is AGP's own documented escape hatch for
   plugins (like this KSP version) that haven't been updated to the new
   `android.sourceSets` model yet — added to `android/gradle.properties`
   with that context in a comment.
4. **A real Canonical.kt bug: `org.json`'s real implementation parses
   decimal numbers as `BigDecimal`, not `Double`.** `Canonical.canonicalize()`
   only handled `Double`/`Float`/`Int`/`Long`, so every event with a
   non-integer coordinate (i.e. all of them) threw
   `IllegalArgumentException: unsupported canonical JSON value: class
   java.math.BigDecimal` the moment a real signature check tried to
   canonicalize it — this is why `EventVerifierTest`/`EventIngestorTest`
   (which load fixtures via `JSONObject(text)`) failed while `CanonicalTest`
   (which mostly canonicalized Kotlin literals directly) mostly didn't.
   Fixed by converting `BigDecimal`/`BigInteger` to `Double`/exact integer
   string respectively before formatting — JSON/JS has no arbitrary-precision
   decimal type, so this matches what the Node signer/verifier does when
   it parses the same JSON text. Covered by a new
   `CanonicalTest` case that parses real JSON text instead of only testing
   Kotlin double literals, so this can't silently regress again.

## Historical reconciliation notes (native-only baseline)

- **C's original project never applied `org.jetbrains.kotlin.android` —
  and that was correct, not a gap.** An earlier pass at this
  reconciliation assumed it was a missing plugin (Kotlin files "should"
  need it) and added it back; actually running the build proved that
  wrong (see "What actually broke on first build" above) — this AGP
  version's built-in Kotlin support means C's original file was already
  right, and re-applying the plugin is what broke it.
- **Compose was removed.** The only place it was used was the placeholder
  "Hello Android" `MainActivity.kt` that Android Studio's wizard generates
  and that this merge replaces with B's real screen;
  `transport/BleSpikeActivity.kt` was always a plain `ComponentActivity`
  with no Compose UI (its own doc comment says as much). Keeping an
  entire unused Compose BOM/dependency stack around — with version
  numbers (`composeBom = "2026.02.01"`, `kotlin.plugin.compose`) nobody
  in this reconciliation could verify against Maven Central — seemed like
  pure risk for zero benefit. `ui/theme/{Color,Theme,Type}.kt` were
  deleted as dead code along with it. **If the team wants Compose for a
  future screen, it's a small, additive change** (re-add the plugin,
  BOM, and `compose = true`) — nothing here structurally depends on its
  absence.
- **Room uses KSP, not kapt — this flipped once, see above.** B's
  original standalone project used KSP; an earlier pass at this
  reconciliation switched to kapt to avoid guessing a KSP-for-Kotlin-2.2.10
  version string. That guess was avoidable, not necessary: kapt turned
  out to be flatly incompatible with this AGP's built-in Kotlin support
  (confirmed by actually running it — AGP's own error names KSP as the
  replacement), and a real compatible KSP version
  (`2.2.10-2.0.2`) was confirmed via Google's own built-in-Kotlin docs.
- **minSdk moved from 24 (B) to 26 (C, kept).** This actually simplified
  B's code: `java.time.Instant` (used throughout `trust/`) ships natively
  from API 26, so the `coreLibraryDesugaring` dependency B's standalone
  project needed for API 24/25 was dropped entirely.
- **compileSdk/targetSdk moved from 34 (B) to 37 (C, kept).** Confirmed
  installed and buildable against (`android-37.0` platform, build-tools
  36.0.0) — this actually built, not just "should work."
- **Two `MainActivity.kt` / two theme files / two Gradle skeletons.**
  Both projects generated a file at these exact paths independently. C's
  versions were discarded in favor of B's (`MainActivity.kt`) or deleted
  as dead code (theme files); see the git history on the merge branch for
  exactly what was replaced.
- **Launcher activity — decided: `MainActivity` stays the launcher.**
  C's manifest had `BleSpikeActivity` as the launcher (convenient for
  solo device testing during the Stage 0 spike, which needed a plain
  activity to launch straight into permission prompts). This merge makes
  B's `MainActivity` the launcher instead, since the offline-GIS screen
  is phase 1's actual product surface per `system.md`, and adds a "BLE
  Spike (Stage 0)" button on `MainActivity` that opens `BleSpikeActivity`
  on demand. `BleSpikeActivity` was a temporary Stage 0 test harness, not
  end-user-facing, so nothing about C's actual deliverable (the BLE
  discovery/transport code itself) depends on which activity the
  launcher icon opens — reachable-by-button is sufficient once Stage 0's
  spike is done. This is a one-line manifest change to revert if it ever
  turns out to matter for a specific test.
- **Theme split.** `MainActivity` extends `AppCompatActivity` and uses
  Material Components views (RecyclerView, themed Toasts), which need a
  `Theme.AppCompat`/`MaterialComponents`-derived theme.
  `BleSpikeActivity` is a bare `ComponentActivity` that doesn't. Rather
  than forcing one activity's requirement onto the other,
  `values/themes.xml` keeps the app-level `Theme.ResilientGeoMesh`
  (platform theme, works for `BleSpikeActivity`) and adds
  `Theme.ResilientGeoMesh.OfflineGis` (MaterialComponents-derived),
  applied only to `MainActivity` via `android:theme` in the manifest.
- **Demo geography moved from Hualien to Neihu.** B's original fixtures
  and `OfflineMapView`'s hardcoded bounding box used placeholder
  coordinates from before the team standardized the whole project's demo
  area on Taipei's Neihu district (`data/fixtures/neihu/scenario.json`, module
  A). Both have been updated: `pipeline/tools/generate-android-fixture.mjs`
  now signs events near the `neihu.dahu` / `neihu.wende` seed points, and
  `OfflineMapView`'s bounding box covers all five `neihu.*` areas with
  margin. The event IDs, hashes, and signatures are freshly generated
  (re-run `npm run generate:android-fixture` any time this needs to
  change) — this is still B's own small demo dataset, distinct from and
  much smaller than module A's real `data/fixtures/neihu/*.json` datasets.

## What's implemented (module B)

| Requirement (team-assignments.md) | Where |
| --- | --- |
| 顯示測試區域離線底圖（道路、避難所圖層） | `../flutter/lib/screens/map_screen.dart`, `../flutter/lib/widgets/map_layers.dart` |
| 本機資料庫，保存事件、版本、到期時間 | `data/EventEntity.kt`, `data/EventDao.kt`, `data/AppDatabase.kt` |
| 事件套用規則：新版覆蓋舊版、過期標示、namespace 隔離 | `ingest/EventIngestor.kt`, `ingest/EventStore.kt` |
| Android 端簽章驗證 adapter | `trust/Canonical.kt`, `trust/Ed25519Verifier.kt`, `trust/EventVerifier.kt`, `trust/EventShapeValidator.kt`, `trust/TrustedKeyStore.kt` |

`FlutterMapBridge` now owns the host integration: Flutter requests the
initial Room snapshot and fixture ingestion through method channels, while
Android continues to own `EventIngestor`, Room and the verification rules.
The older `ui/MainViewModel`/`EventListAdapter` classes remain native support
code from the baseline and are not the normal Flutter launcher surface.

## Design decisions worth knowing about (module B)

### Previous native-only map implementation

`OfflineMapView` is retained as the earlier native-only vector implementation.
It is no longer the normal launcher surface: the Flutter map owns the current
offline basemap and marker/details interaction. The native event and trust
layers remain unchanged and are exposed to Flutter through the bridge above.

### Why Bouncy Castle instead of the platform provider

Android's `java.security` provider only gained Ed25519 support in API 33
(via Conscrypt); `trust/Ed25519Verifier.kt` uses
`org.bouncycastle:bcprov-jdk18on` directly (`Ed25519Signer` /
`PublicKeyFactory`). It also avoids `android.util.Base64` /
`java.util.Base64` in favor of Bouncy Castle's own base64 codec, so the
same class runs unmodified as a plain JVM unit test and on-device.

### Why `Canonical.kt` is a hand-written JSON canonicalizer

Every `payload_hash` and signature in this project is computed over
`pipeline/lib/canonical.mjs`'s `canonicalize()` output: object keys
sorted by UTF-8 byte order, arrays left in place, no whitespace, and
JS-style number formatting (`24.0` serializes as `"24"`). No default JSON
library output matches this byte-for-byte, so `trust/Canonical.kt` is a
direct Kotlin port of the Node function — confirmed to have not drifted
from the current `pipeline/lib/contract.mjs`/`canonical.mjs`: the only
changes there since this was written are chunk/manifest-level
(`area_id`/`theme`/`bbox`), not event-level, which is all this Android
code verifies.

### Why the fixtures are genuinely signed, not placeholder tokens

`fixtures/*.json` at the repo root are explicitly not real signatures
(see `fixtures/README.md`). `pipeline/tools/generate-android-fixture.mjs`
instead generates a fresh Ed25519 keypair and signs events through the
same `pipeline/lib/contract.mjs` module A owns, writing the signed events
and the base64 SPKI public key into both `assets/` (for the app) and
`src/test/resources/` (for JVM unit tests) — private key never written
anywhere. Re-run `npm run generate:android-fixture` from the repo root
whenever the demo scenario needs to change.

The six generated events cover every apply-rule branch:
`official.tdx/road:dahu-01` v1 then v2 (version override), a v1 replay
after v2 is stored (rejected as `version_rollback`),
`official.fire/shelter:wende-01` with an expiry in the past (always
`EXPIRED`), `official.cwa/flood:neihu-0901-001` and the v2 road event
with expiry in 2099 (always `CURRENT`), and `crowd.reports/road:dahu-01`
— same `event_id`, different namespace — landing as `UNVERIFIED` instead
of colliding with the official one.

### Why `EventStore` is an interface

`ingest/EventStore` mirrors the plain `Map` that
`pipeline/lib/contract.mjs`'s `ingestEvent()` takes as its `store`
argument. `ingest/InMemoryEventStore` is the JVM-testable twin (used by
`EventIngestorTest`, which replays the same six-event sequence the
generator script does and asserts identical outcomes), and
`data/RoomEventStore` is the on-device implementation. The apply rules
never talk to Room directly, which is what lets
`RoomEventStoreInstrumentedTest` re-run the same scenario against real
SQLite.

## Known gaps / next steps

The native-only baseline items are resolved. The Flutter embed now builds and
its host unit tests pass; target-device offline restart, Room event
redelivery after Flutter host restart, and marker interaction remain release
acceptance checks.

**Remaining (not blocking):**
- No launcher icon work needed from B — C's project already ships real
  adaptive icons at all densities.
- `GeoJson.kt` only parses Point/LineString/Polygon (what the bundled
  fixtures use); MultiPoint/MultiLineString/MultiPolygon/
  GeometryCollection return `null` (skipped, not crashed).
- No UI for namespace filtering or TTL countdown; Flutter now provides marker
  details for shelters, medical facilities and events.
- Module C's `PeerTransport.kt` interface has no implementation wired
  into `EventIngestor` yet — per `C_BLEbroadcast.md`'s handoff notes,
  that's expected to land once Stage 0's two-device discovery test and a
  real `NearbyConnectionsTransport`/similar are done. `EventStore`'s
  interface boundary (see above) is what will make that plug in without
  touching the apply rules.
- `system.md`/`team-assignments.md` progress notes from B's original
  standalone branch (`b/android-standalone-wip`) still need to be
  reapplied here — `team-assignments.md`'s module B section has now been
  updated to reflect this branch's actual state, but `system.md` has not.
