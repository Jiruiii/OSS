import 'package:flutter/material.dart';

import 'map_models.dart';

/// Immutable camera and style decisions shared by the MapLibre widget and
/// tests.  The renderer owns no product data; it only consumes this config.
class MapLibreMapConfig {
  const MapLibreMapConfig._();

  /// Keep the camera range useful for Taiwan. The checked-in PMTiles currently
  /// contain data through z15; z17 is an intentional vector overzoom until a
  /// higher-detail Taiwan package is generated.
  static const double minZoom = 5;
  static const double maxZoom = 17;
  static const double overviewZoom = 7.5;
  static const double locationZoom = 13;

  static const GeoPoint taiwanOverviewCenter = GeoPoint(
    longitude: 121.05,
    latitude: 23.65,
  );

  static const String lightStyleAsset = 'assets/map/styles/taiwan-light.json';
  static const String darkStyleAsset = 'assets/map/styles/taiwan-dark.json';

  static MapLibreCameraState initialCamera({GeoPoint? currentLocation}) =>
      MapLibreCameraState(
        target: currentLocation ?? taiwanOverviewCenter,
        zoom: currentLocation == null ? overviewZoom : locationZoom,
      );

  static MapLibreCameraState taiwanOverviewCamera() =>
      const MapLibreCameraState(
        target: taiwanOverviewCenter,
        zoom: overviewZoom,
      );

  static String styleAssetFor({
    required ThemeMode themeMode,
    required Brightness systemBrightness,
  }) {
    final isDark =
        themeMode == ThemeMode.dark ||
        (themeMode == ThemeMode.system && systemBrightness == Brightness.dark);
    return isDark ? darkStyleAsset : lightStyleAsset;
  }
}

class MapLibreCameraState {
  const MapLibreCameraState({required this.target, required this.zoom});

  final GeoPoint target;
  final double zoom;
}
