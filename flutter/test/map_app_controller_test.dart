import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/app/map_app_controller.dart';
import 'package:resilientgeo_flutter/data/map_bridge.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test(
    'native bridge without verified layers fails closed instead of using preview JSON',
    () async {
      final controller = MapAppController(bridge: _EmptyVerifiedBridge());
      addTearDown(controller.dispose);

      await controller.load();

      expect(controller.nativeBridgeAvailable, isTrue);
      expect(controller.staticFeatures, isNotNull);
      expect(controller.staticFeatures!.features, isEmpty);
    },
  );

  test(
    'verified static layers arrive after startup instead of blocking it',
    () async {
      final bridge = _SlowStaticLayerBridge();
      final controller = MapAppController(bridge: bridge);
      addTearDown(controller.dispose);

      await controller.load();

      // The map can render while Android is still verifying.
      expect(controller.isLoading, isFalse);
      expect(controller.staticFeaturesPending, isTrue);
      expect(controller.staticFeatures!.features, isEmpty);

      bridge.completer.complete(<StaticFeature>[
        StaticFeature.fromJson(<String, dynamic>{
          'id': 'shelter:5582',
          'kind': 'shelter',
          'name': '西湖國小',
          'geometry': <String, dynamic>{
            'type': 'Point',
            'coordinates': <double>[121.5657, 25.0838],
          },
        }),
      ]);
      await pumpEventQueue();

      expect(controller.staticFeaturesPending, isFalse);
      expect(controller.staticFeatures!.features.single.id, 'shelter:5582');
    },
  );

  test(
    'a failed static layer verification stays empty and never falls back to preview JSON',
    () async {
      final bridge = _SlowStaticLayerBridge();
      final controller = MapAppController(bridge: bridge);
      addTearDown(controller.dispose);

      await controller.load();
      bridge.completer.completeError(
        PlatformException(code: 'static_layer_invalid'),
      );
      await pumpEventQueue();

      expect(controller.nativeBridgeAvailable, isTrue);
      expect(controller.staticFeaturesPending, isFalse);
      expect(controller.staticFeatureLoadError, isA<PlatformException>());
      expect(controller.staticFeatures!.features, isEmpty);
    },
  );

  test(
    'loads the real NCDR demo snapshot when the native bridge is unavailable',
    () async {
      final event = MeshEvent.fromJson(<String, dynamic>{
        'namespace': 'official.ncdr',
        'event_id': 'ncdr:demo',
        'event_version': 1,
        'event_type': 'NCDR_HAZARD',
        'source': 'NCDR',
        'issued_at': '2026-09-26T03:00:00Z',
        'expires_at': '2099-01-01T00:00:00Z',
      });
      final controller = MapAppController(
        bridge: _UnavailableBridge(),
        demoEventLoader: () async => <MeshEvent>[event],
      );
      addTearDown(controller.dispose);

      await controller.load();

      expect(controller.nativeBridgeAvailable, isFalse);
      expect(controller.events, contains(event));
      expect(controller.initialState.events, contains(event));
    },
  );
}

class _EmptyVerifiedBridge extends MapBridge {
  @override
  Future<MapInitialState> getInitialState() async => const MapInitialState(
    events: <MeshEvent>[],
    emergencyModeEnabled: false,
    staticFeatures: <StaticFeature>[],
  );

  @override
  Stream<List<MeshEvent>> get events => const Stream<List<MeshEvent>>.empty();
}

class _SlowStaticLayerBridge extends MapBridge {
  final completer = Completer<List<StaticFeature>>();

  @override
  Future<MapInitialState> getInitialState() async =>
      const MapInitialState(events: <MeshEvent>[], emergencyModeEnabled: false);

  @override
  Future<List<StaticFeature>> getStaticFeatures() => completer.future;

  @override
  Stream<List<MeshEvent>> get events => const Stream<List<MeshEvent>>.empty();
}

class _UnavailableBridge extends MapBridge {
  @override
  Future<MapInitialState> getInitialState() async {
    throw MissingPluginException('native bridge unavailable');
  }
}
