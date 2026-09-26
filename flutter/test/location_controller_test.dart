import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:resilientgeo_flutter/data/location_controller.dart';

void main() {
  final now = DateTime.utc(2026, 9, 27, 3);
  Position fix({
    int ageSeconds = 5,
    double accuracy = 10,
    bool hasAccuracy = true,
  }) => Position(
    longitude: 121.5,
    latitude: 25,
    timestamp: now.subtract(Duration(seconds: ageSeconds)),
    accuracy: accuracy,
    hasAccuracy: hasAccuracy,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );
  test(
    'a recent accurate device fix can avoid waiting for another GPS fix',
    () {
      expect(
        GeolocatorLocationGateway.canUseCachedPosition(fix(), now: now),
        isTrue,
      );
    },
  );
  test('stale, future and inaccurate fixes cannot become a route origin', () {
    for (final position in [
      fix(ageSeconds: 31),
      fix(ageSeconds: -1),
      fix(accuracy: 51),
      fix(accuracy: -1),
      fix(accuracy: double.nan),
      fix(hasAccuracy: false),
    ]) {
      expect(
        GeolocatorLocationGateway.canUseCachedPosition(position, now: now),
        isFalse,
      );
    }
  });
}
