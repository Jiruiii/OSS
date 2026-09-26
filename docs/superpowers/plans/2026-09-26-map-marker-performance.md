# Map marker performance

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
