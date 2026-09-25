import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import 'map_models.dart';

/// Projects WGS84 coordinates into the current MapLibre camera viewport.
///
/// MapLibre uses a Web Mercator world. Keeping this calculation local and
/// synchronous prevents Flutter marker overlays from waiting for the native
/// platform view while the camera is moving. An idle-time native projection
/// can still correct any renderer-specific rounding afterwards.
class MapCameraProjection {
  MapCameraProjection._();

  static const double _tileSize = 512;
  static const double _maxMercatorLatitude = 85.05112878;

  static Offset projectPoint({
    required GeoPoint point,
    required GeoPoint cameraTarget,
    required double zoom,
    required Size viewportSize,
  }) {
    final worldSize = _tileSize * math.pow(2, zoom).toDouble();
    final cameraX = _longitudeToWorld(cameraTarget.longitude);
    final pointX = _longitudeToWorld(point.longitude);
    final wrappedDeltaX = _wrapWorldDelta(pointX - cameraX);
    final pointY = _latitudeToWorld(point.latitude);
    final cameraY = _latitudeToWorld(cameraTarget.latitude);

    return Offset(
      viewportSize.width / 2 + wrappedDeltaX * worldSize,
      viewportSize.height / 2 + (pointY - cameraY) * worldSize,
    );
  }

  static List<Offset> projectPoints({
    required Iterable<GeoPoint> points,
    required GeoPoint cameraTarget,
    required double zoom,
    required Size viewportSize,
  }) {
    return points
        .map(
          (point) => projectPoint(
            point: point,
            cameraTarget: cameraTarget,
            zoom: zoom,
            viewportSize: viewportSize,
          ),
        )
        .toList(growable: false);
  }

  static double _longitudeToWorld(double longitude) {
    return (longitude + 180) / 360;
  }

  static double _latitudeToWorld(double latitude) {
    final clampedLatitude = latitude.clamp(
      -_maxMercatorLatitude,
      _maxMercatorLatitude,
    );
    final latitudeRadians = clampedLatitude * math.pi / 180;
    final mercatorY =
        math.log(math.tan(math.pi / 4 + latitudeRadians / 2)) / math.pi;
    return (1 - mercatorY) / 2;
  }

  static double _wrapWorldDelta(double delta) {
    if (delta > 0.5) {
      return delta - 1;
    }
    if (delta < -0.5) {
      return delta + 1;
    }
    return delta;
  }
}
