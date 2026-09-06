import 'map_models.dart';

/// Shared presentation-only defaults for the Neihu demo.
abstract final class MapDefaults {
  static const double demoLatitude = 25.07455;
  static const double demoLongitude = 121.59108;
  static const GeoPoint demoCurrentLocation = GeoPoint(
    latitude: demoLatitude,
    longitude: demoLongitude,
  );
  static const GeoPoint delayedDemoEventLocation = GeoPoint(
    latitude: 25.07505,
    longitude: 121.59170,
  );
  static const GeoPoint secondDelayedDemoEventLocation = GeoPoint(
    latitude: 25.08062,
    longitude: 121.58482,
  );
  static const GeoPoint thirdDelayedDemoEventLocation = GeoPoint(
    latitude: 25.06892,
    longitude: 121.57874,
  );

  static const String delayedDemoEventId = 'demo:startup:chenggong-road-2';
  static const String secondDelayedDemoEventId =
      'demo:startup:neihu-building-fire';
  static const String thirdDelayedDemoEventId =
      'demo:startup:minquan-road-blockage';

  static const Map<String, int> _demoShelterOccupancy = <String, int>{
    'shelter:5427': 34,
    'shelter:5477': 126,
    'shelter:5483': 72,
    'shelter:5487': 18,
    'shelter:5490': 143,
    'shelter:5493': 67,
    'shelter:5502': 21,
    'shelter:5503': 109,
    'shelter:5509': 58,
    'shelter:5516': 63,
    'shelter:5519': 152,
    'shelter:5537': 97,
    'shelter:5542': 46,
    'shelter:5543': 94,
    'shelter:5548': 61,
    'shelter:5556': 118,
    'shelter:5558': 104,
    'shelter:5567': 37,
    'shelter:5571': 386,
    'shelter:5579': 89,
    'shelter:5582': 31,
    'shelter:5584': 24,
    'shelter:5589': 57,
    'shelter:5592': 12,
    'shelter:5593': 44,
    'shelter:5602': 73,
  };

  /// Returns a UI-only simulated occupancy when no authoritative value exists.
  /// The generic branch keeps future shelter fixtures deterministic as well.
  static int simulatedShelterOccupancy(StaticFeature feature) {
    final configured = _demoShelterOccupancy[feature.id];
    if (configured != null) return configured;

    final capacity = feature.details['capacity'];
    if (capacity is num && capacity > 0) {
      return (capacity * 0.42).round().clamp(1, capacity.toInt());
    }
    return 12;
  }
}
