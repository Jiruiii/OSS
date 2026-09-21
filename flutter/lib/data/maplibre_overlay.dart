import 'map_models.dart';

/// GeoJSON owned by the app and rendered as MapLibre runtime layers.
///
/// Point markers intentionally stay in Flutter so their tap, overlap and
/// accessibility behavior remains identical across Android and Chrome.
class MapLibreOverlayData {
  const MapLibreOverlayData._();

  static Map<String, dynamic> eventFeatureCollection(
    Iterable<MeshEvent> events,
  ) {
    final features = <Map<String, dynamic>>[];
    for (final event in events) {
      final geometry = event.geometry;
      final geometryJson = switch (geometry) {
        LineStringGeometry(:final points) => <String, dynamic>{
          'type': 'LineString',
          'coordinates': points.map(_coordinate).toList(growable: false),
        },
        PolygonGeometry(:final rings) => <String, dynamic>{
          'type': 'Polygon',
          'coordinates': rings
              .map(
                (ring) => ring.map(_coordinate).toList(growable: false),
              )
              .toList(growable: false),
        },
        _ => null,
      };
      if (geometryJson == null) continue;

      final id = meshEventIdentity(event);
      features.add(<String, dynamic>{
        'type': 'Feature',
        'id': id,
        'properties': <String, dynamic>{
          'event_id': id,
          'color': eventColorHex(event),
          'expired': event.isExpired,
          'opacity': event.isExpired ? 0.12 : 0.28,
          'line_width': event.isExpired ? 3 : 5,
        },
        'geometry': geometryJson,
      });
    }
    return <String, dynamic>{
      'type': 'FeatureCollection',
      'features': features,
    };
  }

  static List<double> _coordinate(GeoPoint point) => <double>[
    point.longitude,
    point.latitude,
  ];
}

String eventColorHex(MeshEvent event) {
  if (event.isExpired) return '#616161';
  return switch (event.severity) {
    'CRITICAL' => '#C62828',
    'HIGH' => '#EF6C00',
    'MEDIUM' => '#F9A825',
    _ => '#1565C0',
  };
}
