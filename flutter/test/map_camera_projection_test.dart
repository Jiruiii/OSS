import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_camera_projection.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

void main() {
  const viewport = Size(1000, 800);
  const cameraTarget = GeoPoint(longitude: 121.0, latitude: 23.5);

  test('projects the camera target to the viewport center', () {
    final screen = MapCameraProjection.projectPoint(
      point: cameraTarget,
      cameraTarget: cameraTarget,
      zoom: 8,
      viewportSize: viewport,
    );

    expect(screen.dx, closeTo(500, 0.001));
    expect(screen.dy, closeTo(400, 0.001));
  });

  test('moves east to the right and north upward', () {
    final east = MapCameraProjection.projectPoint(
      point: const GeoPoint(longitude: 121.01, latitude: 23.5),
      cameraTarget: cameraTarget,
      zoom: 8,
      viewportSize: viewport,
    );
    final north = MapCameraProjection.projectPoint(
      point: const GeoPoint(longitude: 121.0, latitude: 23.51),
      cameraTarget: cameraTarget,
      zoom: 8,
      viewportSize: viewport,
    );

    expect(east.dx, greaterThan(500));
    expect(north.dy, lessThan(400));
  });

  test('wraps longitude across the antimeridian to the nearest world copy', () {
    final screen = MapCameraProjection.projectPoint(
      point: const GeoPoint(longitude: -179.9, latitude: 0),
      cameraTarget: const GeoPoint(longitude: 179.9, latitude: 0),
      zoom: 3,
      viewportSize: viewport,
    );

    expect(screen.dx, greaterThan(500));
    expect(screen.dx, lessThan(520));
  });

  test('projects points in input order', () {
    final points = <GeoPoint>[
      const GeoPoint(longitude: 120.9, latitude: 23.4),
      cameraTarget,
      const GeoPoint(longitude: 121.1, latitude: 23.6),
    ];

    final screens = MapCameraProjection.projectPoints(
      points: points,
      cameraTarget: cameraTarget,
      zoom: 8,
      viewportSize: viewport,
    );

    expect(screens, hasLength(points.length));
    expect(screens[1].dx, closeTo(500, 0.001));
    expect(screens[1].dy, closeTo(400, 0.001));
  });

  test('calculates a padded viewport bounds for raw marker filtering', () {
    final bounds = MapCameraProjection.viewportBounds(
      cameraTarget: cameraTarget,
      zoom: 12,
      viewportSize: viewport,
      paddingPixels: 64,
    );

    expect(bounds.contains(cameraTarget), isTrue);
    expect(
      bounds.contains(const GeoPoint(longitude: 121.02, latitude: 23.5)),
      isTrue,
    );
    expect(
      bounds.contains(const GeoPoint(longitude: 121.5, latitude: 23.5)),
      isFalse,
    );
  });
}
