import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/evacuation_models.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

void main() {
  test('parses an ok route in lon-lat order with warnings', () {
    final route = EvacuationRouteResult.fromMessage(<String, dynamic>{
      'status': 'ok',
      'polyline': <dynamic>[
        <dynamic>[121.59, 25.08],
        <dynamic>[121.60, 25.09],
      ],
      'distance_m': 1200,
      'duration_s': 900,
      'graph_version': 'taiwan-walk-test',
      'event_snapshot_at': '2026-09-25T08:30:00Z',
      'warnings': <dynamic>[
        <String, dynamic>{
          'code': 'UNVERIFIED_CROWD_REPORT',
          'event_id': 'report:test',
          'message': '附近有未驗證告警，請現場確認',
        },
      ],
      'blocked_event_ids': <dynamic>['road:closed'],
    });

    expect(route.status, EvacuationRouteStatus.ok);
    expect(route.polyline, hasLength(2));
    expect(route.polyline.first.longitude, 121.59);
    expect(route.polyline.first.latitude, 25.08);
    expect(route.distanceM, 1200);
    expect(route.durationS, 900);
    expect(route.graphVersion, 'taiwan-walk-test');
    expect(route.warnings.single.code, 'UNVERIFIED_CROWD_REPORT');
    expect(route.blockedEventIds, <String>['road:closed']);
  });

  test('parses every non-success status without retaining a route line', () {
    for (final status in <String>[
      'no_route',
      'graph_unavailable',
      'invalid_input',
    ]) {
      final route = EvacuationRouteResult.fromMessage(<String, dynamic>{
        'status': status,
        'polyline': <dynamic>[
          <dynamic>[121.59, 25.08],
          <dynamic>[121.60, 25.09],
        ],
        'distance_m': 1200,
        'duration_s': 900,
        'graph_version': 'ignored',
        'event_snapshot_at': '2026-09-25T08:30:00Z',
        'warnings': <dynamic>[],
        'blocked_event_ids': <dynamic>[],
      });

      expect(route.status.wireValue, status);
      expect(route.polyline, isEmpty);
      expect(route.distanceM, isNull);
      expect(route.durationS, isNull);
    }
  });

  test('rejects malformed ok routes', () {
    final base = <String, dynamic>{
      'status': 'ok',
      'polyline': <dynamic>[
        <dynamic>[121.59, 25.08],
      ],
      'distance_m': 1200,
      'duration_s': 900,
      'graph_version': 'graph',
      'event_snapshot_at': 'snapshot',
      'warnings': <dynamic>[],
      'blocked_event_ids': <dynamic>[],
    };

    expect(
      () => EvacuationRouteResult.fromMessage(base),
      throwsFormatException,
    );

    final negativeDistance =
        <String, dynamic>{...base}
          ..['polyline'] = <dynamic>[
            <dynamic>[121.59, 25.08],
            <dynamic>[121.60, 25.09],
          ]
          ..['distance_m'] = -1;
    expect(
      () => EvacuationRouteResult.fromMessage(negativeDistance),
      throwsFormatException,
    );
  });

  test('serializes a shelter route candidate', () {
    const candidate = ShelterRouteCandidate(
      id: 'shelter:test',
      location: GeoPoint(longitude: 121.5908, latitude: 25.0609),
    );

    expect(candidate.toChannelArguments(), <String, Object?>{
      'id': 'shelter:test',
      'lon': 121.5908,
      'lat': 25.0609,
    });
  });

  test('shortlists at most five point shelters by air distance then id', () {
    const origin = GeoPoint(longitude: 121.5, latitude: 25.0);
    final shelters = <StaticFeature>[
      _shelter('shelter:far', 121.9, 25.4),
      _shelter('shelter:near-b', 121.51, 25.01),
      _shelter('shelter:near-a', 121.51, 25.01),
      _shelter('shelter:3', 121.52, 25.02),
      _shelter('shelter:4', 121.53, 25.03),
      _shelter('shelter:5', 121.54, 25.04),
      _shelter('shelter:6', 121.55, 25.05),
      _shelter('shelter:7', 121.56, 25.06),
      const StaticFeature(
        id: 'medical:not-shelter',
        kind: 'medical',
        geometry: PointGeometry(
          GeoPoint(longitude: 121.5001, latitude: 25.0001),
        ),
        fields: <String, dynamic>{'name': '醫療院所'},
        properties: null,
      ),
      const StaticFeature(
        id: null,
        kind: 'shelter',
        geometry: PointGeometry(
          GeoPoint(longitude: 121.5002, latitude: 25.0002),
        ),
        fields: <String, dynamic>{'name': '沒有編號'},
        properties: null,
      ),
    ];

    final candidates = shortlistShelterCandidates(origin, shelters);

    expect(candidates, hasLength(5));
    expect(candidates.map((candidate) => candidate.id).toList(), <String>[
      'shelter:near-a',
      'shelter:near-b',
      'shelter:3',
      'shelter:4',
      'shelter:5',
    ]);
    expect(candidates, everyElement(isA<ShelterRouteCandidate>()));
  });

  test('shortlist limit cannot expose more than five candidates', () {
    final candidates = shortlistShelterCandidates(
      const GeoPoint(longitude: 121.5, latitude: 25.0),
      List<StaticFeature>.generate(
        8,
        (index) => _shelter('shelter:$index', 121.5 + index / 1000, 25.0),
      ),
      limit: 99,
    );

    expect(candidates, hasLength(5));
  });
}

StaticFeature _shelter(String id, double longitude, double latitude) =>
    StaticFeature(
      id: id,
      kind: 'shelter',
      geometry: PointGeometry(
        GeoPoint(longitude: longitude, latitude: latitude),
      ),
      fields: const <String, dynamic>{'name': '測試避難所'},
      properties: null,
    );
