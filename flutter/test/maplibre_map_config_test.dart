import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/maplibre_map_config.dart';

void main() {
  group('MapLibreMapConfig', () {
    test('uses the user location when it is available', () {
      const location = GeoPoint(longitude: 121.545053, latitude: 25.011549);

      final camera = MapLibreMapConfig.initialCamera(currentLocation: location);

      expect(camera.target, same(location));
      expect(camera.zoom, MapLibreMapConfig.locationZoom);
    });

    test('falls back to a Taiwan overview when location is unavailable', () {
      final camera = MapLibreMapConfig.initialCamera();

      expect(camera.target, same(MapLibreMapConfig.taiwanOverviewCenter));
      expect(camera.zoom, MapLibreMapConfig.overviewZoom);
    });

    test('recenter camera always targets the Taiwan overview', () {
      final camera = MapLibreMapConfig.taiwanOverviewCamera();

      expect(camera.target, same(MapLibreMapConfig.taiwanOverviewCenter));
      expect(camera.zoom, MapLibreMapConfig.overviewZoom);
    });

    test('selects local light and dark style assets', () {
      expect(
        MapLibreMapConfig.styleAssetFor(
          themeMode: ThemeMode.light,
          systemBrightness: Brightness.dark,
        ),
        'assets/map/styles/taiwan-light.json',
      );
      expect(
        MapLibreMapConfig.styleAssetFor(
          themeMode: ThemeMode.system,
          systemBrightness: Brightness.dark,
        ),
        'assets/map/styles/taiwan-dark.json',
      );
    });

    test('camera range permits z17 vector overzoom beyond the z15 package', () {
      expect(MapLibreMapConfig.minZoom, 5);
      expect(MapLibreMapConfig.maxZoom, 17);
      expect(MapLibreMapConfig.overviewZoom, greaterThan(5));
    });
  });
}
