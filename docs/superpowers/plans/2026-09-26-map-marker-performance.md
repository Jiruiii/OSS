# Map marker performance

## Status — 2026-09-27

- [x] Preserve the nationwide static layer; cache layouts and administrative aggregation, reuse markers during panning, and cull facilities outside the viewport.
- [x] Normalize Android physical pixels to Flutter logical pixels so markers remain visible after camera idle. GPS updates no longer rebuild the static layout.
- [x] Keep nationwide search parsing/indexing off the UI isolate and reuse complete PMTiles by content version. Correct Android glyph/sprite asset paths.
- [x] Pixel 8a AOT profile street panning: Flutter build p95 3.1 ms, raster p95 4.1 ms, total span p95 9.1 ms; no build/raster frame above 16 ms in the final 600-frame sample. Idle markers were checked on the phone.
- [x] Flutter analyze and all 234 Flutter tests pass; Android tests and route/device measurements are recorded separately.
- [ ] Repeat performance checks on other devices and under sustained heat/memory pressure; this round did not repeat the Chrome gesture benchmark.

See [device measurements and limits](../../taipei-offline-routing.md). Cold road-search initialization remains about 6.8 seconds in the background, and total profile app PSS is about 1.1 GiB. Flutter timings are not a measurement of complete MapLibre GPU FPS. The original scope below is retained.

## Goal

Keep the nationwide Taiwan static layer while preventing Flutter overlay marker rebuilds from blocking map gestures.

## Scope

1. Cache the computed marker layout and invalidate it only when data, filters, zoom level, or the settled camera changes.
2. Reuse the cached layout while the camera is moving; only project existing marker points for the current frame.
3. Do not build overlay markers before MapLibre is ready.
4. At raw-marker zoom levels, filter facilities to the current viewport with a small screen-space margin.
5. Show a map-layer loading overlay until the first marker layout and screen projection are ready.

## Verification

- Unit tests cover cache invalidation and viewport bounds.
- Existing Flutter test suite and `flutter analyze` pass.
- Flutter Web starts successfully and a browser drag remains responsive.
- Nationwide static features remain present in the source asset.

## Constraints

- Keep all 7,887 nationwide features in the asset.
- Preserve existing clustering, selection, and event filtering behavior.
- Do not change Android Room or pipeline data contracts.
