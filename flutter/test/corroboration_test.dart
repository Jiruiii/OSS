import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/corroboration.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

final now = DateTime.utc(2026, 9, 24, 2);

MeshEvent crowd({
  required String key,
  String category = 'FLOOD',
  double lon = 121.5761,
  double lat = 25.0795,
  String issuedAt = '2026-09-24T01:00:00Z',
  String expiresAt = '2026-09-24T07:00:00Z',
  String applyState = 'UNVERIFIED',
  String namespace = 'crowd.reports',
}) => MeshEvent(
  namespace: namespace,
  eventId: 'report:$key:${lon}_${lat}_$issuedAt',
  eventVersion: 1,
  eventType: 'CROWD_REPORT',
  severity: 'HIGH',
  source: 'CROWD',
  issuedAt: issuedAt,
  expiresAt: expiresAt,
  applyState: applyState,
  geometry: PointGeometry(GeoPoint(longitude: lon, latitude: lat)),
  attributes: <String, dynamic>{'category': category},
  signingKeyId: 'device:$key',
);

void main() {
  final subject = crowd(key: 'a');

  int count(List<MeshEvent> others) =>
      corroborationCount(subject, <MeshEvent>[subject, ...others], now: now);

  test('distinct devices nearby with the same category are counted', () {
    expect(count(<MeshEvent>[crowd(key: 'b'), crowd(key: 'c')]), 3);
    expect(corroborationLabel(count(<MeshEvent>[crowd(key: 'b')])), '2 人回報');
  });

  test('the same key reporting twice counts once', () {
    expect(
      count(<MeshEvent>[
        crowd(key: 'a', issuedAt: '2026-09-24T01:10:00Z'),
        crowd(key: 'a', issuedAt: '2026-09-24T01:20:00Z'),
      ]),
      1,
    );
    expect(corroborationLabel(1), isNull);
  });

  test(
    'other categories, far reports, old reports and expired ones do not count',
    () {
      expect(
        count(<MeshEvent>[
          crowd(key: 'b', category: 'FIRE_SMOKE'),
          crowd(key: 'c', lat: 25.0815), // ~220 m north
          crowd(key: 'd', issuedAt: '2026-09-23T22:30:00Z'), // 2.5 h earlier
          crowd(
            key: 'e',
            applyState: 'EXPIRED',
            expiresAt: '2026-09-24T01:30:00Z',
          ),
          crowd(key: 'f', namespace: 'official.cwa', applyState: 'CURRENT'),
        ]),
        1,
      );
    },
  );

  test('the wording never claims verification', () {
    for (var n = 2; n < 10; n++) {
      final label = corroborationLabel(n)!;
      expect(label.contains('驗證'), isFalse);
      expect(label.contains('查證'), isFalse);
    }
  });
}
