import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/route_event_snapshot.dart';

void main() {
  final now = DateTime.utc(2030);
  test(
    'snapshot is independent of event order and ignores unrelated official data',
    () {
      final road = event('road', 'ROAD_STATUS');
      final shelter = event('shelter', 'SHELTER_STATUS');
      final original = RouteEventSnapshot([road, shelter], now);
      final replay = RouteEventSnapshot([
        shelter,
        event('weather', 'HEAT_WARNING'),
        road,
      ], now);
      expect(original.fingerprint, replay.fingerprint);
      expect(original.changeReason(replay), isNull);
    },
  );

  test('expiry and removals are detected from the captured state', () {
    final road = event(
      'road',
      'ROAD_STATUS',
      expires: now.add(const Duration(seconds: 5)),
    );
    final original = RouteEventSnapshot([road], now);
    expect(
      RouteEventSnapshot.nextExpiry([road], now),
      now.add(const Duration(seconds: 5)),
    );
    expect(
      original.changeReason(
        RouteEventSnapshot([road], now.add(const Duration(seconds: 5))),
      ),
      '事件到期',
    );
    expect(original.changeReason(RouteEventSnapshot([], now)), '道路狀態更新');
  });

  test('all live crowd warnings affect routing regardless of event type', () {
    final original = RouteEventSnapshot([], now);
    final crowd = event('report', 'OTHER', namespace: 'crowd.test');
    expect(original.changeReason(RouteEventSnapshot([crowd], now)), '民眾警示更新');
  });
}

MeshEvent event(
  String id,
  String type, {
  String namespace = 'official',
  DateTime? expires,
}) => MeshEvent(
  namespace: namespace,
  eventId: id,
  eventVersion: 1,
  eventType: type,
  severity: 'HIGH',
  source: 'test',
  issuedAt: null,
  expiresAt: expires?.toIso8601String(),
  applyState: 'CURRENT',
  geometry: null,
  attributes: null,
);
