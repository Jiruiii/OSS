import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/screens/map_screen.dart';

void main() {
  test('bundles the static Neihu map data for rootBundle loading', () async {
    final raw = await rootBundle.loadString(
      'assets/data/neihu/static-features.json',
    );

    expect(raw, contains('resilientgeo-neihu'));
  });

  test('bundles fixture-only demo events for rootBundle loading', () async {
    final raw = await rootBundle.loadString(
      'assets/data/neihu/demo-events.json',
    );

    expect(raw, contains('demo:flood:001'));
  });

  testWidgets(
    'initial screen keeps offline status, simulation warning, and layer control visible',
    (tester) async {
      await tester.pumpWidget(_testApp());
      await tester.pump();

      expect(find.text('離線地圖可用'), findsOneWidget);
      expect(find.text('模擬事件，非即時官方災情'), findsOneWidget);
      expect(find.bySemanticsLabel('圖層設定'), findsOneWidget);
    },
  );
}

Widget _testApp() => const MaterialApp(
  home: MapScreen(
    staticFeatures: StaticFeatureCollection(
      schemaVersion: 'test',
      datasetId: 'test',
      snapshotAt: '2026-09-05T00:00:00Z',
      features: <StaticFeature>[],
    ),
    demoEvents: <MeshEvent>[],
    initialState: MapInitialState(
      events: <MeshEvent>[],
      emergencyModeEnabled: false,
    ),
  ),
);
