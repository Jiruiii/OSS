import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/map_models.dart';

void main() {
  test('parses a static LineString feature with its exact coordinates', () {
    final feature = StaticFeature.fromJson(<String, dynamic>{
      'id': 'osm:way:1014301596',
      'kind': 'road',
      'geometry': <String, dynamic>{
        'type': 'LineString',
        'coordinates': <dynamic>[
          <dynamic>[121.6154878, 25.1006944],
          <dynamic>[121.6155328, 25.1006142],
        ],
      },
      'properties': null,
    });

    expect(feature.id, 'osm:way:1014301596');
    expect(feature.kind, 'road');
    expect(feature.properties, isNull);
    expect(feature.geometry, isA<LineStringGeometry>());
    final geometry = feature.geometry! as LineStringGeometry;
    expect(geometry.points, hasLength(2));
    expect(geometry.points.first.longitude, 121.6154878);
    expect(geometry.points.last.latitude, 25.1006142);
  });

  test('parses Point, LineString, and Polygon event geometries', () {
    final point = MeshEvent.fromJson(<String, dynamic>{
      'namespace': 'official.fire',
      'event_id': 'shelter:wende-01',
      'event_version': 1,
      'event_type': 'SHELTER_STATUS',
      'severity': 'HIGH',
      'geometry': <String, dynamic>{
        'type': 'Point',
        'coordinates': <dynamic>[121.5849, 25.0786],
      },
    });
    final line = MeshEvent.fromJson(<String, dynamic>{
      'namespace': 'official.tdx',
      'event_id': 'road:dahu-01',
      'event_version': 2,
      'event_type': 'ROAD_STATUS',
      'severity': 'HIGH',
      'geometry': <String, dynamic>{
        'type': 'LineString',
        'coordinates': <dynamic>[
          <dynamic>[121.5993, 25.0825],
          <dynamic>[121.6053, 25.085],
        ],
      },
    });
    final polygon = MeshEvent.fromJson(<String, dynamic>{
      'namespace': 'official.cwa',
      'event_id': 'flood:neihu-0901-001',
      'event_version': 1,
      'event_type': 'FLOOD_WARNING',
      'severity': 'CRITICAL',
      'geometry': <String, dynamic>{
        'type': 'Polygon',
        'coordinates': <dynamic>[
          <dynamic>[
            <dynamic>[121.565, 25.065],
            <dynamic>[121.615, 25.065],
            <dynamic>[121.615, 25.09],
            <dynamic>[121.565, 25.065],
          ],
        ],
      },
    });

    expect(point.geometry, isA<PointGeometry>());
    expect((point.geometry! as PointGeometry).point.latitude, 25.0786);
    expect(line.geometry, isA<LineStringGeometry>());
    expect(
      (line.geometry! as LineStringGeometry).points.last.longitude,
      121.6053,
    );
    expect(polygon.geometry, isA<PolygonGeometry>());
    expect((polygon.geometry! as PolygonGeometry).rings.single, hasLength(4));
  });

  test('preserves nullable event fields and flags expired events', () {
    final event = MeshEvent.fromJson(<String, dynamic>{
      'namespace': 'crowd.reports',
      'event_id': 'road:dahu-01',
      'event_version': null,
      'event_type': null,
      'severity': null,
      'source': null,
      'issued_at': null,
      'expires_at': '2020-01-01T00:00:00Z',
      'apply_state': 'EXPIRED',
      'geometry': null,
      'attributes': null,
    });

    expect(event.eventVersion, isNull);
    expect(event.eventType, isNull);
    expect(event.severity, isNull);
    expect(event.source, isNull);
    expect(event.issuedAt, isNull);
    expect(event.attributes, isNull);
    expect(event.geometry, isNull);
    expect(event.applyState, 'EXPIRED');
    expect(event.isExpired, isTrue);
  });
}
