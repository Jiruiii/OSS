import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/screens/map_screen.dart';

void main() {
  test('parses point, line, and polygon event geometries', () {
    final point = MeshEvent.fromJson(
      _eventJson('Point', <dynamic>[121.59, 25.08]),
    );
    final line = MeshEvent.fromJson(
      _eventJson('LineString', <dynamic>[
        <dynamic>[121.58, 25.07],
        <dynamic>[121.59, 25.08],
      ]),
    );
    final polygon = MeshEvent.fromJson(
      _eventJson('Polygon', <dynamic>[
        <dynamic>[
          <dynamic>[121.58, 25.07],
          <dynamic>[121.60, 25.07],
          <dynamic>[121.60, 25.09],
          <dynamic>[121.58, 25.07],
        ],
      ]),
    );

    expect(point.geometry, isA<PointGeometry>());
    expect(line.geometry, isA<LineStringGeometry>());
    expect(polygon.geometry, isA<PolygonGeometry>());
  });

  test('Android apply_state controls expired event display state', () {
    final event = MeshEvent.fromJson(
      _eventJson('Point', <dynamic>[121.59, 25.08], applyState: 'EXPIRED'),
    );

    expect(event.isExpired, isTrue);
  });

  testWidgets('tapping a shelter opens its details with unknown occupancy', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(features: const <StaticFeature>[_shelter]),
    );
    await _finishMapLoad(tester);

    await tester.tap(find.bySemanticsLabel('潭美國小'));
    await tester.pump();

    expect(find.text('潭美國小'), findsOneWidget);
    expect(find.text('預計收容人數：81人'), findsOneWidget);
    expect(find.text('目前收容人數：無資料'), findsOneWidget);
    expect(find.text('來源：taipei-shelter'), findsOneWidget);
    expect(find.text('快照：2026-09-05T00:00:00Z'), findsOneWidget);
  });

  testWidgets('tapping a medical marker opens medical details', (tester) async {
    await tester.pumpWidget(
      _testApp(features: const <StaticFeature>[_medical]),
    );
    await _finishMapLoad(tester);

    await tester.tap(find.bySemanticsLabel('三軍總醫院內湖院區'));
    await tester.pump();

    expect(find.text('三軍總醫院內湖院區'), findsOneWidget);
    expect(find.text('類型：醫院'), findsOneWidget);
    expect(find.text('來源：taipei-medical'), findsOneWidget);
  });

  testWidgets('tapping an expired event opens severity and expiry details', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(
        features: const <StaticFeature>[],
        events: <MeshEvent>[_expiredEvent],
      ),
    );
    await _finishMapLoad(tester);

    await tester.tap(find.bySemanticsLabel('事件：內湖模擬淹水，已過期'));
    await tester.pump();

    expect(find.text('事件類型：FLOOD_WARNING'), findsOneWidget);
    expect(find.text('嚴重度：CRITICAL'), findsOneWidget);
    expect(find.text('位置／範圍：點位（25.083506, 121.590304）'), findsOneWidget);
    expect(find.text('到期時間：2026-09-01T07:00:00Z'), findsOneWidget);
    expect(find.text('資料狀態：已過期'), findsOneWidget);
  });

  testWidgets('overlapping shelter and medical markers show a chooser', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(features: const <StaticFeature>[_shelter, _medicalAtShelter]),
    );
    await _finishMapLoad(tester);

    await tester.tap(find.bySemanticsLabel('重疊地點：潭美國小、測試醫院'));
    await tester.pumpAndSettle();

    expect(find.text('選擇地點'), findsOneWidget);
    expect(find.text('潭美國小'), findsOneWidget);
    expect(find.text('測試醫院'), findsOneWidget);

    await tester.tap(find.text('潭美國小'));
    await tester.pumpAndSettle();
    expect(find.text('目前收容人數：無資料'), findsOneWidget);
  });

  testWidgets('layer panel can hide the event layer', (tester) async {
    await tester.pumpWidget(
      _testApp(
        features: const <StaticFeature>[],
        events: <MeshEvent>[_expiredEvent],
      ),
    );
    await _finishMapLoad(tester);

    await tester.tap(find.bySemanticsLabel('圖層設定'));
    await tester.pumpAndSettle();
    expect(find.text('災情事件'), findsOneWidget);

    await tester.tap(find.byType(Switch).at(2));
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch).at(2)).value, isFalse);
    expect(find.bySemanticsLabel('事件：內湖模擬淹水，已過期'), findsNothing);
  });
}

Future<void> _finishMapLoad(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}

Widget _testApp({
  required List<StaticFeature> features,
  List<MeshEvent> events = const <MeshEvent>[],
}) => MaterialApp(
  home: MapScreen(
    staticFeatures: StaticFeatureCollection(
      schemaVersion: 'test',
      datasetId: 'test',
      snapshotAt: '2026-09-05T00:00:00Z',
      features: features,
    ),
    demoEvents: events,
    initialState: const MapInitialState(
      events: <MeshEvent>[],
      emergencyModeEnabled: false,
    ),
  ),
);

Map<String, dynamic> _eventJson(
  String geometryType,
  List<dynamic> coordinates, {
  String applyState = 'CURRENT',
}) => <String, dynamic>{
  'namespace': 'demo.neihu',
  'event_id': 'demo:event',
  'event_version': 1,
  'event_type': 'FLOOD_WARNING',
  'severity': 'CRITICAL',
  'source': 'demo',
  'issued_at': '2026-09-01T06:00:00Z',
  'expires_at': '2026-09-01T07:00:00Z',
  'apply_state': applyState,
  'geometry': <String, dynamic>{
    'type': geometryType,
    'coordinates': coordinates,
  },
  'attributes': <String, dynamic>{'name': '內湖模擬淹水'},
};

final _expiredEvent = MeshEvent.fromJson(
  _eventJson('Point', <dynamic>[121.590304, 25.083506], applyState: 'EXPIRED'),
);

const _shelter = StaticFeature(
  id: 'shelter:test',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.590304, latitude: 25.083506)),
  fields: <String, dynamic>{
    'name': '潭美國小',
    'address': '內湖區新明路22號',
    'capacity': 81,
    'available_count': null,
    'disaster_types': <String>['水災', '震災'],
    'source': 'taipei-shelter',
  },
  properties: null,
);

const _medical = StaticFeature(
  id: 'medical:test',
  kind: 'medical',
  geometry: PointGeometry(GeoPoint(longitude: 121.61, latitude: 25.09)),
  fields: <String, dynamic>{
    'name': '三軍總醫院內湖院區',
    'facility_type': '醫院',
    'address': '內湖區成功路二段325號',
    'source': 'taipei-medical',
  },
  properties: null,
);

const _medicalAtShelter = StaticFeature(
  id: 'medical:overlap',
  kind: 'medical',
  geometry: PointGeometry(GeoPoint(longitude: 121.590304, latitude: 25.083506)),
  fields: <String, dynamic>{
    'name': '測試醫院',
    'facility_type': '醫院',
    'address': '內湖測試路1號',
    'source': 'taipei-medical',
  },
  properties: null,
);
