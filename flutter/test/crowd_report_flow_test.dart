import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/bridge_failure.dart';
import 'package:resilientgeo_flutter/data/crowd_report_models.dart';
import 'package:resilientgeo_flutter/data/location_controller.dart';
import 'package:resilientgeo_flutter/data/map_bridge.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/screens/map_screen.dart';

void main() {
  testWidgets('submits a current-location report as unverified and pending', (
    tester,
  ) async {
    final bridge = _FakeMapBridge();
    await tester.pumpWidget(_app(bridge: bridge));
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('回報告警'));
    await tester.pump();
    await tester.tap(find.text('使用目前位置'));
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('crowd-report-confirm')),
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('crowd-report-confirm')),
    );
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('crowd-report-submit')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('crowd-report-submit')));
    await tester.pump();

    expect(bridge.submitCalls, 1);
    expect(find.text('民眾告警：未驗證／待同步'), findsOneWidget);
    expect(find.text('告警編號：report:test'), findsOneWidget);
    expect(find.text('事件：道路阻斷'), findsNothing);
  });

  testWidgets('preserves the report draft through map point selection', (
    tester,
  ) async {
    await tester.pumpWidget(_app(bridge: _FakeMapBridge()));
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('回報告警'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey<String>('crowd-report-description')),
      '地圖點選的落石',
    );
    await tester.ensureVisible(find.text('地圖拖拉定位'));
    await tester.tap(find.text('地圖拖拉定位'));
    await tester.pump();
    expect(
      find.byKey(const ValueKey<String>('report-location-center-pin')),
      findsOneWidget,
    );
    await tester.tap(find.text('MapLibre 台灣離線地圖預覽'));
    await tester.pump();

    expect(find.text('地圖中心：23.650000, 121.050000'), findsOneWidget);

    await tester.tap(
      find.byKey(const ValueKey<String>('report-location-confirm')),
    );
    await tester.pump();
    expect(find.text('確認內容'), findsOneWidget);
    expect(find.text('地圖拖拉定位：23.650000, 121.050000'), findsOneWidget);
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey<String>('crowd-report-description')),
          )
          .initialValue,
      '地圖點選的落石',
    );
  });

  testWidgets('keeps the form open and explains a location failure', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(bridge: _FakeMapBridge(), locationAvailable: false),
    );
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('回報告警'));
    await tester.pump();
    await tester.tap(find.text('使用目前位置'));
    await tester.pump();

    expect(find.text('無法取得目前位置，請開啟瀏覽器或裝置定位權限'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('crowd-report-confirm')),
      findsOneWidget,
    );
  });

  testWidgets('does not claim success when the native bridge is unavailable', (
    tester,
  ) async {
    final bridge = _FakeMapBridge(
      failure: const BridgeFailure(
        code: BridgeFailureCode.unavailable,
        message: 'missing plugin',
      ),
    );
    await tester.pumpWidget(_app(bridge: bridge));
    await _finishLoad(tester);

    await _fillAndSubmit(tester);

    expect(find.text('此功能需要 Android App，Chrome 僅供地圖與資料預覽'), findsOneWidget);
    expect(find.text('民眾告警：未驗證／待同步'), findsNothing);
  });

  testWidgets('does not claim success when secure signing fails', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        bridge: _FakeMapBridge(
          failure: const BridgeFailure(
            code: BridgeFailureCode.signingUnavailable,
            message: 'native failure',
          ),
        ),
      ),
    );
    await _finishLoad(tester);
    await _fillAndSubmit(tester);

    expect(find.text('民眾告警：未驗證／待同步'), findsNothing);
    expect(
      find.byKey(const ValueKey<String>('crowd-report-submit')),
      findsOneWidget,
    );
  });

  testWidgets('does not claim success when outbox storage fails', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        bridge: _FakeMapBridge(
          failure: const BridgeFailure(
            code: BridgeFailureCode.storageUnavailable,
            message: 'native failure',
          ),
        ),
      ),
    );
    await _finishLoad(tester);
    await _fillAndSubmit(tester);

    expect(find.text('民眾告警：未驗證／待同步'), findsNothing);
    expect(
      find.byKey(const ValueKey<String>('crowd-report-submit')),
      findsOneWidget,
    );
  });

  testWidgets('prevents duplicate report submissions while awaiting Android', (
    tester,
  ) async {
    final pending = Completer<CrowdReportSubmission>();
    final bridge = _FakeMapBridge(pending: pending);
    await tester.pumpWidget(_app(bridge: bridge));
    await _finishLoad(tester);
    await _openAndSetLocation(tester);

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('crowd-report-submit')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('crowd-report-submit')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('crowd-report-submit')));
    expect(bridge.submitCalls, 1);

    pending.complete(_submission());
    await tester.pump();
    expect(find.text('民眾告警：未驗證／待同步'), findsOneWidget);
  });
}

Future<void> _fillAndSubmit(WidgetTester tester) async {
  await _openAndSetLocation(tester);
  await tester.ensureVisible(
    find.byKey(const ValueKey<String>('crowd-report-submit')),
  );
  await tester.tap(find.byKey(const ValueKey<String>('crowd-report-submit')));
  await tester.pump();
}

Future<void> _openAndSetLocation(WidgetTester tester) async {
  await tester.tap(find.bySemanticsLabel('回報告警'));
  await tester.pump();
  await tester.tap(find.text('使用目前位置'));
  await tester.pump();
  await tester.ensureVisible(
    find.byKey(const ValueKey<String>('crowd-report-confirm')),
  );
  await tester.tap(find.byKey(const ValueKey<String>('crowd-report-confirm')));
  await tester.pump();
}

Future<void> _finishLoad(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

Widget _app({
  required MapBridge bridge,
  bool locationAvailable = true,
  GeoPoint? location,
}) => MaterialApp(
  home: MapScreen(
    key: UniqueKey(),
    staticFeatures: const StaticFeatureCollection(
      schemaVersion: 'test',
      datasetId: 'test',
      snapshotAt: '2026-09-25T00:00:00Z',
      features: <StaticFeature>[],
    ),
    initialState: const MapInitialState(
      events: <MeshEvent>[],
      emergencyModeEnabled: false,
    ),
    bridge: bridge,
    locationController: _FakeLocationController(
      locationAvailable
          ? (location ?? const GeoPoint(longitude: 121.5, latitude: 25))
          : null,
    ),
  ),
);

class _FakeMapBridge extends MapBridge {
  _FakeMapBridge({this.failure, this.pending})
    : super(methodChannel: const MethodChannel('test/crowd-report-flow'));

  final BridgeFailure? failure;
  final Completer<CrowdReportSubmission>? pending;
  int submitCalls = 0;

  @override
  Future<MapInitialState> getInitialState() async =>
      const MapInitialState(events: <MeshEvent>[], emergencyModeEnabled: false);

  @override
  Stream<List<MeshEvent>> get events => const Stream<List<MeshEvent>>.empty();

  @override
  Future<CrowdReportSubmission> submitCrowdReport(CrowdReportDraft draft) {
    submitCalls += 1;
    final error = failure;
    if (error != null) return Future<CrowdReportSubmission>.error(error);
    final waiting = pending;
    if (waiting != null) return waiting.future;
    return Future<CrowdReportSubmission>.value(_submission());
  }
}

class _FakeLocationController extends LocationController {
  _FakeLocationController(this.result);

  final GeoPoint? result;

  @override
  Stream<GeoPoint> get locations => const Stream<GeoPoint>.empty();

  @override
  Future<GeoPoint?> requestCurrentLocation() async => result;
}

CrowdReportSubmission _submission() => const CrowdReportSubmission(
  eventId: 'report:test',
  applyState: 'UNVERIFIED',
  deliveryState: 'PENDING',
);
