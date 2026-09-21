import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/maplibre_overlay.dart';

void main() {
  test('converts event lines and polygons to GeoJSON while omitting points', () {
    const line = MeshEvent(
      namespace: 'test',
      eventId: 'line-1',
      eventVersion: 1,
      eventType: 'ROAD_BLOCKAGE',
      severity: 'HIGH',
      source: 'fixture',
      issuedAt: null,
      expiresAt: null,
      applyState: 'CURRENT',
      geometry: LineStringGeometry(<GeoPoint>[
        GeoPoint(longitude: 121.5, latitude: 25.0),
        GeoPoint(longitude: 121.6, latitude: 25.1),
      ]),
      attributes: null,
    );
    const polygon = MeshEvent(
      namespace: 'test',
      eventId: 'polygon-1',
      eventVersion: 2,
      eventType: 'FLOOD',
      severity: 'CRITICAL',
      source: 'fixture',
      issuedAt: null,
      expiresAt: null,
      applyState: 'EXPIRED',
      geometry: PolygonGeometry(<List<GeoPoint>>[
        <GeoPoint>[
          GeoPoint(longitude: 121.4, latitude: 24.9),
          GeoPoint(longitude: 121.5, latitude: 24.9),
          GeoPoint(longitude: 121.5, latitude: 25.0),
          GeoPoint(longitude: 121.4, latitude: 24.9),
        ],
      ]),
      attributes: null,
    );
    const point = MeshEvent(
      namespace: 'test',
      eventId: 'point-1',
      eventVersion: 1,
      eventType: 'ALERT',
      severity: 'LOW',
      source: 'fixture',
      issuedAt: null,
      expiresAt: null,
      applyState: 'CURRENT',
      geometry: PointGeometry(GeoPoint(longitude: 121.5, latitude: 25.0)),
      attributes: null,
    );

    final collection = MapLibreOverlayData.eventFeatureCollection(
      <MeshEvent>[line, polygon, point],
    );
    final features = collection['features']! as List<Object?>;

    expect(features, hasLength(2));
    expect((features[0] as Map<String, dynamic>)['geometry'], containsPair('type', 'LineString'));
    expect((features[1] as Map<String, dynamic>)['geometry'], containsPair('type', 'Polygon'));
    expect(
      ((features[1] as Map<String, dynamic>)['properties']
          as Map<String, dynamic>)['expired'],
      isTrue,
    );
  });
}
