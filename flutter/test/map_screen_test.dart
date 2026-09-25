import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/screens/map_screen.dart';
import 'package:resilientgeo_flutter/widgets/map_layers.dart'
    show MapIconCatalog;

void main() {
  test('bundles the static Neihu map data for rootBundle loading', () async {
    final raw = await rootBundle.loadString(
      'assets/data/neihu/static-features.json',
    );

    expect(raw, contains('resilientgeo-neihu'));
  });

  test('bundles the all-Taiwan offline road search asset', () async {
    final raw = await rootBundle.loadString(
      'assets/map/search/taiwan-roads.json',
    );

    expect(raw, contains('"dataset_id":"taiwan-roads"'));
    expect(raw, contains('"attribution":"© OpenStreetMap contributors"'));
  });

  testWidgets(
    'initial screen shows formatted update time and icon-only quick actions',
    (tester) async {
      await tester.pumpWidget(_testApp());
      await tester.pump();

      expect(find.text('更新時間：2026-9-5 00:00:00'), findsOneWidget);
      expect(find.text('資料快照：2026-09-05T00:00:00Z'), findsNothing);
      expect(find.text('目前位置：尚未取得'), findsOneWidget);
      final updateTime = tester.widget<Text>(
        find.text('更新時間：2026-9-5 00:00:00'),
      );
      expect(updateTime.maxLines, 1);
      expect(updateTime.softWrap, isFalse);
      expect(find.text('回報告警'), findsNothing);
      expect(find.text('推薦最近避難所'), findsNothing);
      expect(find.byTooltip('回報告警'), findsOneWidget);
      expect(find.byTooltip('推薦最近避難所'), findsOneWidget);
      expect(tester.getTopLeft(find.byTooltip('回報告警')).dx, greaterThan(200));
      expect(tester.getTopLeft(find.byTooltip('推薦最近避難所')).dx, greaterThan(200));
      expect(find.byIcon(LucideIcons.mapPinHouse), findsOneWidget);
      expect(find.byIcon(MapIconCatalog.shelter), findsNothing);
      expect(find.byIcon(Icons.near_me), findsNothing);
      expect(
        tester.getRect(find.byTooltip('推薦最近避難所')).left,
        greaterThan(tester.getRect(find.byTooltip('回報告警')).right),
      );
      expect(find.text('離線地圖可用'), findsNothing);
      expect(find.text('Protomaps 台灣離線底圖'), findsNothing);
      expect(find.text('模擬事件，非即時官方災情'), findsNothing);
      expect(find.byIcon(Icons.layers_outlined), findsOneWidget);
      expect(find.bySemanticsLabel('圖層設定'), findsOneWidget);
    },
  );

  testWidgets('offline map controls remain available at 390dp width', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_testApp());
    await tester.pump();

    expect(find.bySemanticsLabel('搜尋地點'), findsOneWidget);
    expect(find.bySemanticsLabel('圖層設定'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('layer settings does not expose the bundled fixture loader', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp());
    await tester.pump();

    await tester.tap(find.bySemanticsLabel('圖層設定'));
    await tester.pumpAndSettle();

    expect(find.text('載入內建 fixture'), findsNothing);
  });
}

Widget _testApp() => const MaterialApp(
  home: MapScreen(
    staticFeatures: StaticFeatureCollection(
      schemaVersion: 'test',
      datasetId: 'test',
      snapshotAt: '2026-09-05T00:00:00Z',
      features: <StaticFeature>[],
    ),
    initialState: MapInitialState(
      events: <MeshEvent>[],
      emergencyModeEnabled: false,
    ),
  ),
);
