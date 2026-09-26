import 'dart:math' as math;

import 'attestation_index.dart';
import 'map_models.dart';

/// Several devices reporting the same thing in the same place.
///
/// This is NOT verification: one person with several phones can inflate it
/// (experiments/limitations.md), so the wording must never say 驗證/查證.
const corroborationRadiusMeters = 150.0;
const corroborationWindow = Duration(hours: 2);

/// Number of distinct device keys that filed a live report of the same
/// category within [corroborationRadiusMeters] and [corroborationWindow] of
/// [report], the report's own key included.
int corroborationCount(
  MeshEvent report,
  Iterable<MeshEvent> events, {
  DateTime? now,
}) {
  final reference = (now ?? DateTime.now()).toUtc();
  final origin = _point(report);
  final category = report.attributes?['category'];
  final issued = _time(report.issuedAt);
  if (!isCrowdEvent(report) ||
      origin == null ||
      category is! String ||
      issued == null) {
    return 0;
  }
  final keys = <String>{};
  for (final event in events) {
    if (!isCrowdEvent(event) || !event.isShownAt(reference)) continue;
    final key = event.signingKeyId;
    final point = _point(event);
    final eventIssued = _time(event.issuedAt);
    if (key == null || point == null || eventIssued == null) continue;
    if (event.attributes?['category'] != category) continue;
    if (eventIssued.difference(issued).abs() > corroborationWindow) continue;
    if (_distanceMeters(origin, point) > corroborationRadiusMeters) continue;
    keys.add(key);
  }
  return keys.length;
}

/// 「N 人回報」 once at least two devices agree; null otherwise.
String? corroborationLabel(int count) => count >= 2 ? '$count 人回報' : null;

GeoPoint? _point(MeshEvent event) => switch (event.geometry) {
  PointGeometry(:final point) => point,
  _ => null,
};

DateTime? _time(String? value) =>
    value == null ? null : DateTime.tryParse(value)?.toUtc();

double _distanceMeters(GeoPoint a, GeoPoint b) {
  const earthRadius = 6371008.8;
  final dLat = (b.latitude - a.latitude) * math.pi / 180;
  final dLon = (b.longitude - a.longitude) * math.pi / 180;
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(a.latitude * math.pi / 180) *
          math.cos(b.latitude * math.pi / 180) *
          math.pow(math.sin(dLon / 2), 2);
  return 2 * earthRadius * math.asin(math.min(1, math.sqrt(h)));
}
