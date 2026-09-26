import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/app/map_app_controller.dart';
import 'package:resilientgeo_flutter/data/map_bridge.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

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

class _UnavailableBridge extends MapBridge {
  @override
  Future<MapInitialState> getInitialState() async {
    throw MissingPluginException('native bridge unavailable');
  }
}
