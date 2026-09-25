import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/bridge_failure.dart';
import 'package:resilientgeo_flutter/data/evacuation_models.dart';
import 'package:resilientgeo_flutter/data/location_controller.dart';
import 'package:resilientgeo_flutter/data/map_bridge.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/screens/map_screen.dart';

void main() {
  testWidgets('plans a route with the exact Android request and presents it', (
    tester,
  ) async {
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(_app(bridge: bridge));
    await _finishLoad(tester);

    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    expect(bridge.routeCalls, 1);
    expect(bridge.lastOrigin, const GeoPoint(longitude: 121.5, latitude: 25.0));
    expect(bridge.lastDestination?.id, 'shelter:test');
    expect(
      bridge.lastDestination?.location,
      const GeoPoint(longitude: 121.590304, latitude: 25.083506),
    );
    expect(bridge.lastMode, 'walk');
    expect(find.text('距離：1.2 公里'), findsOneWidget);
    expect(find.text('路網版本：taiwan-walk-test'), findsOneWidget);
  });

  testWidgets('acquires location before routing when the runtime has none', (
    tester,
  ) async {
    final location = const GeoPoint(longitude: 121.5, latitude: 25.0);
    final locationController = _FakeLocationController(location);
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(
      _app(bridge: bridge, locationController: locationController),
    );
    await _finishLoad(tester);

    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    expect(locationController.requests, 1);
    expect(bridge.routeCalls, 1);
    expect(find.text('目前位置：已取得'), findsOneWidget);
  });

  testWidgets('keeps the route sheet open and explains a location failure', (
    tester,
  ) async {
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(
      _app(bridge: bridge, locationController: _FakeLocationController(null)),
    );
    await _finishLoad(tester);

    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    expect(find.text('無法取得目前位置，請開啟瀏覽器或裝置定位權限'), findsOneWidget);
    expect(bridge.routeCalls, 0);
  });

  testWidgets('rejects a shelter without an id before calling Android', (
    tester,
  ) async {
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(
      _app(bridge: bridge, features: const <StaticFeature>[_invalidShelter]),
    );
    await _finishLoad(tester);

    await _openShelterDetails(tester, '無編號避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    expect(find.text('起點或避難所資料不完整'), findsOneWidget);
    expect(bridge.routeCalls, 0);
  });

  testWidgets('renders every native route status without a fallback line', (
    tester,
  ) async {
    final expected = <EvacuationRouteStatus, String>{
      EvacuationRouteStatus.noRoute: '找不到可達路線',
      EvacuationRouteStatus.graphUnavailable: '離線路網尚未載入',
      EvacuationRouteStatus.invalidInput: '起點或避難所資料不完整',
    };
    for (final entry in expected.entries) {
      await tester.pumpWidget(
        _app(bridge: _RouteBridge(result: _routeStatus(entry.key))),
      );
      await _finishLoad(tester);
      await _openShelterDetails(tester, '測試避難所');
      await tester.tap(find.text('規劃逃生路線'));
      await tester.pump();

      expect(find.text(entry.value), findsOneWidget);
      expect(find.textContaining('距離：'), findsNothing);
      expect(find.text('MapLibre 台灣離線地圖預覽'), findsOneWidget);
    }
  });

  testWidgets('bridge unavailability is an honest route failure', (
    tester,
  ) async {
    final bridge = _RouteBridge(
      failure: const BridgeFailure(
        code: BridgeFailureCode.unavailable,
        message: 'missing plugin',
      ),
    );
    await tester.pumpWidget(_app(bridge: bridge));
    await _finishLoad(tester);
    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    expect(find.text('此功能需要 Android App，Chrome 僅供地圖與資料預覽'), findsOneWidget);
    expect(find.textContaining('距離：'), findsNothing);
  });

  testWidgets(
    'keeps an unverified warning visible without blocking the route',
    (tester) async {
      final bridge = _RouteBridge(result: _okRoute(withWarning: true));
      await tester.pumpWidget(_app(bridge: bridge));
      await _finishLoad(tester);
      await _openShelterDetails(tester, '測試避難所');
      await tester.tap(find.text('規劃逃生路線'));
      await tester.pump();

      expect(find.text('距離：1.2 公里'), findsOneWidget);
      expect(find.text('附近有未驗證告警，請現場確認'), findsOneWidget);
      expect(find.text('受路線快照排除事件：'), findsNothing);
    },
  );

  testWidgets('identical event replay does not stale a ready route', (
    tester,
  ) async {
    final updates = StreamController<List<MeshEvent>>.broadcast();
    addTearDown(updates.close);
    final first = _event('road:one', 1);
    final second = _event('road:two', 1);
    await tester.pumpWidget(
      _app(
        bridge: _RouteBridge(result: _okRoute()),
        events: <MeshEvent>[first, second],
        eventUpdates: updates.stream,
      ),
    );
    await _finishLoad(tester);
    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    updates.add(<MeshEvent>[second, first]);
    await tester.pump();
    expect(find.text('路線資訊已變更，請重新計算'), findsNothing);
  });

  testWidgets('changed event identity marks a ready route stale', (
    tester,
  ) async {
    final updates = StreamController<List<MeshEvent>>.broadcast();
    addTearDown(updates.close);
    final first = _event('road:one', 1);
    await tester.pumpWidget(
      _app(
        bridge: _RouteBridge(result: _okRoute()),
        events: <MeshEvent>[first],
        eventUpdates: updates.stream,
      ),
    );
    await _finishLoad(tester);
    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    updates.add(<MeshEvent>[_event('road:one', 2)]);
    await tester.pump();
    expect(find.text('路線資訊已變更，請重新計算'), findsOneWidget);
  });

  testWidgets(
    'event change during calculation makes the returned route stale',
    (tester) async {
      final updates = StreamController<List<MeshEvent>>.broadcast();
      addTearDown(updates.close);
      final pending = Completer<EvacuationRouteResult>();
      await tester.pumpWidget(
        _app(
          bridge: _RouteBridge(pending: pending),
          events: <MeshEvent>[_event('road:one', 1)],
          eventUpdates: updates.stream,
        ),
      );
      await _finishLoad(tester);
      await _openShelterDetails(tester, '測試避難所');
      await tester.tap(find.text('規劃逃生路線'));
      await tester.pump();
      updates.add(<MeshEvent>[_event('road:one', 2)]);
      await tester.pump();

      pending.complete(_okRoute());
      await tester.pump();
      expect(find.text('路線資訊已變更，請重新計算'), findsOneWidget);
    },
  );

  testWidgets('recalculation reuses the selected destination', (tester) async {
    final updates = StreamController<List<MeshEvent>>.broadcast();
    addTearDown(updates.close);
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(
      _app(
        bridge: bridge,
        events: <MeshEvent>[_event('road:one', 1)],
        eventUpdates: updates.stream,
      ),
    );
    await _finishLoad(tester);
    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();
    updates.add(<MeshEvent>[_event('road:one', 2)]);
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey<String>('recalculate-evacuation-route')),
    );
    await tester.pump();

    expect(bridge.routeCalls, 2);
    expect(bridge.destinations[0].id, bridge.destinations[1].id);
    expect(bridge.destinations[0].location, bridge.destinations[1].location);
  });

  testWidgets('ignores an older response after the route sheet is closed', (
    tester,
  ) async {
    final first = Completer<EvacuationRouteResult>();
    final second = Completer<EvacuationRouteResult>();
    final bridge = _RouteBridge(
      pendings: <Completer<EvacuationRouteResult>>[first, second],
    );
    await tester.pumpWidget(
      _app(
        bridge: bridge,
        features: const <StaticFeature>[_shelter, _secondShelter],
      ),
    );
    await _finishLoad(tester);

    await _openShelterDetails(tester, '測試避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();
    await tester.tap(find.byTooltip('關閉路線'));
    await tester.pump();
    await _openShelterDetails(tester, '第二避難所');
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    first.complete(_okRoute(distanceM: 999));
    await tester.pump();
    expect(find.text('距離：999 公尺'), findsNothing);

    second.complete(_okRoute(distanceM: 700));
    await tester.pump();
    expect(find.text('距離：700 公尺'), findsOneWidget);
  });

  testWidgets(
    'recommends the lowest Android route distance, not air distance',
    (tester) async {
      final bridge = _RouteBridge(
        resultsByShelterId: <String, EvacuationRouteResult>{
          'shelter:a': _okRoute(distanceM: 1500),
          'shelter:b': _okRoute(distanceM: 700),
          'shelter:c': _routeStatus(EvacuationRouteStatus.noRoute),
        },
      );
      await tester.pumpWidget(
        _app(
          bridge: bridge,
          features: const <StaticFeature>[_shelterA, _shelterB, _shelterC],
        ),
      );
      await _finishLoad(tester);

      await tester.tap(find.bySemanticsLabel('推薦最近避難所'));
      await tester.pump();

      expect(bridge.routeCalls, 3);
      expect(find.text('距離：700 公尺'), findsOneWidget);
      expect(find.text('距離：1500 公尺'), findsNothing);
      expect(find.text('找不到可達路線'), findsNothing);
    },
  );

  testWidgets('recommendation reports no shelters without a fake route', (
    tester,
  ) async {
    final bridge = _RouteBridge(result: _okRoute());
    await tester.pumpWidget(
      _app(bridge: bridge, features: const <StaticFeature>[]),
    );
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('推薦最近避難所'));
    await tester.pump();

    expect(find.text('目前沒有可推薦的避難所'), findsOneWidget);
    expect(find.textContaining('距離：'), findsNothing);
    expect(bridge.routeCalls, 0);
  });

  testWidgets(
    'recommendation is bounded to five Android route calls and shows progress',
    (tester) async {
      final pending = <Completer<EvacuationRouteResult>>[
        Completer<EvacuationRouteResult>(),
        Completer<EvacuationRouteResult>(),
        Completer<EvacuationRouteResult>(),
        Completer<EvacuationRouteResult>(),
        Completer<EvacuationRouteResult>(),
      ];
      final bridge = _RouteBridge(pendings: pending);
      await tester.pumpWidget(
        _app(
          bridge: bridge,
          features: List<StaticFeature>.generate(
            7,
            (index) => StaticFeature(
              id: 'shelter:$index',
              kind: 'shelter',
              geometry: PointGeometry(
                GeoPoint(longitude: 121.50 + index / 1000, latitude: 25.0),
              ),
              fields: <String, dynamic>{'name': '候選避難所$index'},
              properties: null,
            ),
          ),
        ),
      );
      await _finishLoad(tester);

      await tester.tap(find.bySemanticsLabel('推薦最近避難所'));
      await tester.pump();
      expect(find.text('正在比較可達避難所（1/5）'), findsOneWidget);
      expect(bridge.routeCalls, 1);

      for (var index = 0; index < pending.length; index += 1) {
        pending[index].complete(_routeStatus(EvacuationRouteStatus.noRoute));
        await tester.pump();
      }
      expect(bridge.routeCalls, 5);
      expect(find.text('找不到可達路線'), findsOneWidget);
    },
  );

  testWidgets('recommendation aborts on graph failure without interim route', (
    tester,
  ) async {
    final bridge = _RouteBridge(
      resultsByShelterId: <String, EvacuationRouteResult>{
        'shelter:a': _routeStatus(EvacuationRouteStatus.graphUnavailable),
        'shelter:b': _okRoute(distanceM: 100),
      },
    );
    await tester.pumpWidget(
      _app(
        bridge: bridge,
        features: const <StaticFeature>[_shelterA, _shelterB],
      ),
    );
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('推薦最近避難所'));
    await tester.pump();

    expect(find.text('離線路網尚未載入'), findsOneWidget);
    expect(find.textContaining('距離：'), findsNothing);
    expect(bridge.routeCalls, 1);
  });

  testWidgets('recommendation aborts when event data changes', (tester) async {
    final updates = StreamController<List<MeshEvent>>.broadcast();
    addTearDown(updates.close);
    final pending = Completer<EvacuationRouteResult>();
    await tester.pumpWidget(
      _app(
        bridge: _RouteBridge(pending: pending),
        features: const <StaticFeature>[_shelterA, _shelterB],
        events: <MeshEvent>[_event('road:one', 1)],
        eventUpdates: updates.stream,
      ),
    );
    await _finishLoad(tester);

    await tester.tap(find.bySemanticsLabel('推薦最近避難所'));
    await tester.pump();
    updates.add(<MeshEvent>[_event('road:one', 2)]);
    await tester.pump();
    pending.complete(_okRoute(distanceM: 100));
    await tester.pump();

    expect(find.text('事件資料已更新，請重新計算推薦避難所'), findsOneWidget);
    expect(find.textContaining('距離：'), findsNothing);
  });

  testWidgets('route and alert actions remain reachable at 390dp', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final updates = StreamController<List<MeshEvent>>.broadcast();
    addTearDown(updates.close);
    await tester.pumpWidget(
      _app(
        bridge: _RouteBridge(result: _okRoute()),
        eventUpdates: updates.stream,
      ),
    );
    await _finishLoad(tester);

    expect(find.bySemanticsLabel('回報告警'), findsOneWidget);
    expect(find.bySemanticsLabel('推薦最近避難所'), findsOneWidget);
    await _openShelterDetails(tester, '測試避難所');
    await tester.ensureVisible(find.text('規劃逃生路線'));
    expect(find.text('規劃逃生路線'), findsOneWidget);
    await tester.tap(find.text('規劃逃生路線'));
    await tester.pump();

    updates.add(<MeshEvent>[_event('road:changed', 1)]);
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('recalculate-evacuation-route')),
    );
    expect(find.text('路線資訊已變更，請重新計算'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _openShelterDetails(WidgetTester tester, String name) async {
  await tester.tap(find.bySemanticsLabel(name));
  await tester.pump();
  expect(find.text('規劃逃生路線'), findsOneWidget);
}

Future<void> _finishLoad(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

Widget _app({
  required MapBridge bridge,
  List<StaticFeature> features = const <StaticFeature>[_shelter],
  List<MeshEvent> events = const <MeshEvent>[],
  Stream<List<MeshEvent>>? eventUpdates,
  LocationController? locationController,
}) => MaterialApp(
  home: MapScreen(
    key: UniqueKey(),
    staticFeatures: StaticFeatureCollection(
      schemaVersion: 'test',
      datasetId: 'test',
      snapshotAt: '2026-09-25T00:00:00Z',
      features: features,
    ),
    initialState: MapInitialState(events: events, emergencyModeEnabled: false),
    bridge: bridge,
    eventUpdates: eventUpdates,
    locationController:
        locationController ??
        _FakeLocationController(
          const GeoPoint(longitude: 121.5, latitude: 25.0),
        ),
  ),
);

class _RouteBridge extends MapBridge {
  _RouteBridge({
    this.result,
    this.failure,
    this.pending,
    this.pendings,
    this.resultsByShelterId,
  }) : super(methodChannel: const MethodChannel('test/route-flow'));

  final EvacuationRouteResult? result;
  final BridgeFailure? failure;
  final Completer<EvacuationRouteResult>? pending;
  final List<Completer<EvacuationRouteResult>>? pendings;
  final Map<String, EvacuationRouteResult>? resultsByShelterId;
  int routeCalls = 0;
  GeoPoint? lastOrigin;
  ShelterRouteCandidate? lastDestination;
  String? lastMode;
  final List<ShelterRouteCandidate> destinations = <ShelterRouteCandidate>[];

  @override
  Future<MapInitialState> getInitialState() async =>
      const MapInitialState(events: <MeshEvent>[], emergencyModeEnabled: false);

  @override
  Stream<List<MeshEvent>> get events => const Stream<List<MeshEvent>>.empty();

  @override
  Future<EvacuationRouteResult> calculateEvacuationRoute({
    required GeoPoint origin,
    required ShelterRouteCandidate destination,
    String mode = 'walk',
  }) {
    routeCalls += 1;
    lastOrigin = origin;
    lastDestination = destination;
    lastMode = mode;
    destinations.add(destination);
    final error = failure;
    if (error != null) return Future<EvacuationRouteResult>.error(error);
    final queue = pendings;
    if (queue != null) return queue[routeCalls - 1].future;
    final waiting = pending;
    if (waiting != null) return waiting.future;
    final selected = resultsByShelterId?[destination.id] ?? result;
    return Future<EvacuationRouteResult>.value(selected!);
  }
}

class _FakeLocationController extends LocationController {
  _FakeLocationController(this.result);

  final GeoPoint? result;
  int requests = 0;

  @override
  Stream<GeoPoint> get locations => const Stream<GeoPoint>.empty();

  @override
  Future<GeoPoint?> requestCurrentLocation() async {
    requests += 1;
    return result;
  }
}

EvacuationRouteResult _okRoute({
  double distanceM = 1200,
  bool withWarning = false,
}) => EvacuationRouteResult(
  status: EvacuationRouteStatus.ok,
  polyline: const <GeoPoint>[
    GeoPoint(longitude: 121.5, latitude: 25.0),
    GeoPoint(longitude: 121.55, latitude: 25.04),
    GeoPoint(longitude: 121.590304, latitude: 25.083506),
  ],
  distanceM: distanceM,
  durationS: 900,
  graphVersion: 'taiwan-walk-test',
  eventSnapshotAt: '2026-09-25T00:00:00Z',
  warnings:
      withWarning
          ? const <RouteWarning>[
            RouteWarning(
              code: 'UNVERIFIED_CROWD_REPORT',
              eventId: 'report:test',
              message: '附近有未驗證告警，請現場確認',
            ),
          ]
          : const <RouteWarning>[],
  blockedEventIds: const <String>[],
);

EvacuationRouteResult _routeStatus(EvacuationRouteStatus status) =>
    EvacuationRouteResult(
      status: status,
      polyline: const <GeoPoint>[],
      distanceM: null,
      durationS: null,
      graphVersion: null,
      eventSnapshotAt: null,
      warnings: const <RouteWarning>[],
      blockedEventIds: const <String>[],
    );

MeshEvent _event(String id, int version) => MeshEvent(
  namespace: 'official',
  eventId: id,
  eventVersion: version,
  eventType: 'ROAD_BLOCKAGE',
  severity: 'HIGH',
  source: 'test',
  issuedAt: null,
  expiresAt: null,
  applyState: 'CURRENT',
  geometry: const PointGeometry(GeoPoint(longitude: 121.55, latitude: 25.04)),
  attributes: null,
);

const _shelter = StaticFeature(
  id: 'shelter:test',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.590304, latitude: 25.083506)),
  fields: <String, dynamic>{'name': '測試避難所', 'available_count': null},
  properties: null,
);

const _secondShelter = StaticFeature(
  id: 'shelter:second',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.61, latitude: 25.09)),
  fields: <String, dynamic>{'name': '第二避難所', 'available_count': null},
  properties: null,
);

const _invalidShelter = StaticFeature(
  id: null,
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.590304, latitude: 25.083506)),
  fields: <String, dynamic>{'name': '無編號避難所', 'available_count': null},
  properties: null,
);

const _shelterA = StaticFeature(
  id: 'shelter:a',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.51, latitude: 25.01)),
  fields: <String, dynamic>{'name': '候選 A'},
  properties: null,
);

const _shelterB = StaticFeature(
  id: 'shelter:b',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.52, latitude: 25.02)),
  fields: <String, dynamic>{'name': '候選 B'},
  properties: null,
);

const _shelterC = StaticFeature(
  id: 'shelter:c',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.53, latitude: 25.03)),
  fields: <String, dynamic>{'name': '候選 C'},
  properties: null,
);
