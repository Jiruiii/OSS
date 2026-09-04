# ResilientGeo Mesh — Android

Single Android project, jointly owned:

- **Module B (GIS & 本機資料庫)** — offline map, local database, apply
  rules, Ed25519 trust adapter. `MainActivity` is the app's launcher.
- **Module C (Peer Sync & 傳輸層)** — Stage 0 BLE discovery spike
  (`transport/`), reachable from a button on `MainActivity`. See
  `C_BLEbroadcast.md` at the repo root for C's device-tested findings.

This file was rewritten while reconciling two Android projects that were
built independently on separate branches (B built a full Gradle skeleton
from scratch; C built one via Android Studio's project wizard for the BLE
spike). The reconciliation kept **C's** Gradle/AGP/Kotlin toolchain and
resource conventions as the base and ported B's code into it — see
"Reconciliation notes" below for exactly what that involved and which
decisions still need a second pair of eyes.

## Build status

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

**Not yet verified**: the "BLE Spike (Stage 0)" button's navigation into
`BleSpikeActivity` on this merged manifest/theme setup — tap it and
confirm it still behaves like `C_BLEbroadcast.md` describes (permission
prompts, `ResilientGeoBle` logcat output).

### Local setup that isn't part of the repo (per-machine)

- `JAVA_HOME` must point at a real JDK 17+. Android Studio bundles one —
  on this machine that was `<Android Studio install dir>/jbr` (find the
  real install dir via `%LOCALAPPDATA%\Google\AndroidStudio*\.home` if
  Android Studio itself was installed somewhere other than
  `Program Files`). `gradle-daemon-jvm.properties` requests JDK 25
  specifically; Android Studio's bundled JBR happened to already be 25.
- `android/local.properties` (gitignored, not committed) needs
  `sdk.dir=<path to Android SDK>`. Default location is
  `%LOCALAPPDATA%\Android\Sdk`; Android Studio's own SDK Manager creates
  and manages this.

### What actually broke on first build (and why the fixes are what they are)

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

## Reconciliation notes (read before trusting this build)

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
- **Launcher activity — a judgment call, confirm with the team.**
  C's manifest had `BleSpikeActivity` as the launcher (convenient for
  solo device testing). This merge makes B's `MainActivity` the launcher
  instead, since the offline-GIS screen is phase 1's actual product
  surface per `system.md`, and adds a "BLE Spike (Stage 0)" button on
  `MainActivity` that opens `BleSpikeActivity` instead. If C's workflow
  depends on BLE spike being the first thing that opens on install, say
  so and this is a one-line manifest change to revert.
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
  area on Taipei's Neihu district (`fixtures/neihu/scenario.json`, module
  A). Both have been updated: `pipeline/tools/generate-android-fixture.mjs`
  now signs events near the `neihu.dahu` / `neihu.wende` seed points, and
  `OfflineMapView`'s bounding box covers all five `neihu.*` areas with
  margin. The event IDs, hashes, and signatures are freshly generated
  (re-run `npm run generate:android-fixture` any time this needs to
  change) — this is still B's own small demo dataset, distinct from and
  much smaller than module A's real `fixtures/neihu/*.json` datasets.

## What's implemented (module B)

| Requirement (team-assignments.md) | Where |
| --- | --- |
| 顯示測試區域離線底圖（道路、避難所圖層） | `map/OfflineMapView.kt`, `map/GeoJson.kt`, `map/Geometry.kt` |
| 本機資料庫，保存事件、版本、到期時間 | `data/EventEntity.kt`, `data/EventDao.kt`, `data/AppDatabase.kt` |
| 事件套用規則：新版覆蓋舊版、過期標示、namespace 隔離 | `ingest/EventIngestor.kt`, `ingest/EventStore.kt` |
| Android 端簽章驗證 adapter | `trust/Canonical.kt`, `trust/Ed25519Verifier.kt`, `trust/EventVerifier.kt`, `trust/EventShapeValidator.kt`, `trust/TrustedKeyStore.kt` |

`MainActivity` + `ui/MainViewModel` + `ui/EventListAdapter` wire these
together: a "Load bundled test events" button feeds
`assets/fixtures/signed-events.json` through `EventIngestor` into Room,
and the map + list both observe Room directly.

## Design decisions worth knowing about (module B)

### Why not a tiled basemap

`OfflineMapView` draws the Neihu test area as a fixed-bounding-box vector
canvas — roads/shelters/hazard polygons rendered directly from event
geometry, nothing else. No binary tile assets, no map SDK, no API keys,
no network access of any kind. What you see is exactly what's in the
local database, which is exactly what passed `EventVerifier`. Swapping in
a real tiled basemap for Neihu is a reasonable follow-up (module A
already has real OSM geometry in `fixtures/neihu/osm-snapshot.json`) but
is additive — it wouldn't change `EventEntity`, `EventIngestor`, or the
trust adapter, only what `MainActivity` hands to the map view.

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

**Blocking a merge-back to `main`:**
- [ ] Verify the "BLE Spike (Stage 0)" button still navigates into
  `BleSpikeActivity` correctly and its permission/logcat behavior
  matches `C_BLEbroadcast.md` on this merged manifest/theme setup.
- [ ] Get C to confirm the launcher-activity swap (`MainActivity` instead
  of `BleSpikeActivity`) is acceptable — see "Reconciliation notes"
  above; it's a one-line manifest revert if not.
- [ ] Decide whether/when to merge `merge/android-b-into-c-skeleton` into
  `main` and push — currently just a local trial branch.

**Not blocking, but not done either:**
- No launcher icon work needed from B — C's project already ships real
  adaptive icons at all densities.
- `GeoJson.kt` only parses Point/LineString/Polygon (what the bundled
  fixtures use); MultiPoint/MultiLineString/MultiPolygon/
  GeometryCollection return `null` (skipped, not crashed).
- No UI for namespace filtering, TTL countdown, or manual event
  inspection beyond the flat list.
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
