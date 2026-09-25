import 'dart:math' as math;

import 'map_models.dart';

enum EvacuationRouteStatus { ok, noRoute, graphUnavailable, invalidInput }

extension EvacuationRouteStatusWire on EvacuationRouteStatus {
  String get wireValue => switch (this) {
    EvacuationRouteStatus.ok => 'ok',
    EvacuationRouteStatus.noRoute => 'no_route',
    EvacuationRouteStatus.graphUnavailable => 'graph_unavailable',
    EvacuationRouteStatus.invalidInput => 'invalid_input',
  };

  static EvacuationRouteStatus fromWire(Object? value) => switch (value) {
    'ok' => EvacuationRouteStatus.ok,
    'no_route' => EvacuationRouteStatus.noRoute,
    'graph_unavailable' => EvacuationRouteStatus.graphUnavailable,
    'invalid_input' => EvacuationRouteStatus.invalidInput,
    _ => throw FormatException('Unknown evacuation route status: $value'),
  };
}

final class ShelterRouteCandidate {
  const ShelterRouteCandidate({required this.id, required this.location});

  final String id;
  final GeoPoint location;

  Map<String, Object?> toChannelArguments() => <String, Object?>{
    'id': id,
    'lon': location.longitude,
    'lat': location.latitude,
  };
}

List<ShelterRouteCandidate> shortlistShelterCandidates(
  GeoPoint origin,
  Iterable<StaticFeature> shelters, {
  int limit = 5,
}) {
  final cappedLimit = limit.clamp(0, 5).toInt();
  if (cappedLimit == 0 || !_validPoint(origin)) {
    return const <ShelterRouteCandidate>[];
  }

  final ranked = <_ShelterCandidateDistance>[];
  for (final shelter in shelters) {
    if (shelter.kind != 'shelter') continue;
    final id = shelter.id;
    final geometry = shelter.geometry;
    if (id == null || id.isEmpty || geometry is! PointGeometry) continue;
    if (!_validPoint(geometry.point)) continue;
    ranked.add(
      _ShelterCandidateDistance(
        candidate: ShelterRouteCandidate(id: id, location: geometry.point),
        airDistanceSquared: _airDistanceSquared(origin, geometry.point),
      ),
    );
  }
  ranked.sort((left, right) {
    final distanceOrder = left.airDistanceSquared.compareTo(
      right.airDistanceSquared,
    );
    if (distanceOrder != 0) return distanceOrder;
    return left.candidate.id.compareTo(right.candidate.id);
  });
  return ranked
      .take(cappedLimit)
      .map((entry) => entry.candidate)
      .toList(growable: false);
}

final class _ShelterCandidateDistance {
  const _ShelterCandidateDistance({
    required this.candidate,
    required this.airDistanceSquared,
  });

  final ShelterRouteCandidate candidate;
  final double airDistanceSquared;
}

bool _validPoint(GeoPoint point) =>
    point.longitude.isFinite &&
    point.latitude.isFinite &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    point.latitude >= -90 &&
    point.latitude <= 90;

double _airDistanceSquared(GeoPoint origin, GeoPoint destination) {
  final latitudeRadians =
      ((origin.latitude + destination.latitude) / 2) * math.pi / 180;
  final longitudeDelta =
      (origin.longitude - destination.longitude) * math.cos(latitudeRadians);
  final latitudeDelta = origin.latitude - destination.latitude;
  return longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
}

final class RouteWarning {
  const RouteWarning({
    required this.code,
    required this.eventId,
    required this.message,
  });

  final String code;
  final String? eventId;
  final String message;

  factory RouteWarning.fromMessage(Object? value) {
    final map = _asMap(value, 'route warning');
    final code = map['code'];
    final message = map['message'];
    final eventId = map['event_id'];
    if (code is! String ||
        code.isEmpty ||
        message is! String ||
        message.isEmpty) {
      throw const FormatException('route warning is missing code or message');
    }
    if (eventId != null && eventId is! String) {
      throw const FormatException('route warning event_id must be a string');
    }
    return RouteWarning(
      code: code,
      eventId: eventId as String?,
      message: message,
    );
  }
}

final class EvacuationRouteResult {
  const EvacuationRouteResult({
    required this.status,
    required this.polyline,
    required this.distanceM,
    required this.durationS,
    required this.graphVersion,
    required this.eventSnapshotAt,
    required this.warnings,
    required this.blockedEventIds,
  });

  final EvacuationRouteStatus status;
  final List<GeoPoint> polyline;
  final double? distanceM;
  final double? durationS;
  final String? graphVersion;
  final String? eventSnapshotAt;
  final List<RouteWarning> warnings;
  final List<String> blockedEventIds;

  factory EvacuationRouteResult.fromMessage(Map<String, dynamic> message) {
    final status = EvacuationRouteStatusWire.fromWire(message['status']);
    final warnings = _warnings(message['warnings']);
    final blockedEventIds = _blockedEventIds(message['blocked_event_ids']);
    if (status != EvacuationRouteStatus.ok) {
      return EvacuationRouteResult(
        status: status,
        polyline: const <GeoPoint>[],
        distanceM: null,
        durationS: null,
        graphVersion: _optionalString(message['graph_version']),
        eventSnapshotAt: _optionalString(message['event_snapshot_at']),
        warnings: warnings,
        blockedEventIds: blockedEventIds,
      );
    }

    final polyline = _polyline(message['polyline']);
    if (polyline.length < 2) {
      throw const FormatException(
        'ok route needs at least two polyline points',
      );
    }
    final distanceM = _requiredNonNegativeNumber(message['distance_m']);
    final durationS = _requiredNonNegativeNumber(message['duration_s']);
    final graphVersion = _requiredString(message['graph_version']);
    final eventSnapshotAt = _requiredString(message['event_snapshot_at']);
    return EvacuationRouteResult(
      status: status,
      polyline: polyline,
      distanceM: distanceM,
      durationS: durationS,
      graphVersion: graphVersion,
      eventSnapshotAt: eventSnapshotAt,
      warnings: warnings,
      blockedEventIds: blockedEventIds,
    );
  }
}

List<RouteWarning> _warnings(Object? value) {
  if (value == null) return const <RouteWarning>[];
  if (value is! List) throw const FormatException('warnings must be a list');
  return value.map(RouteWarning.fromMessage).toList(growable: false);
}

List<String> _blockedEventIds(Object? value) {
  if (value == null) return const <String>[];
  if (value is! List || value.any((item) => item is! String)) {
    throw const FormatException('blocked_event_ids must be a string list');
  }
  return value.cast<String>().toList(growable: false);
}

List<GeoPoint> _polyline(Object? value) {
  if (value is! List) throw const FormatException('polyline must be a list');
  return value.map(_point).toList(growable: false);
}

GeoPoint _point(Object? value) {
  if (value is! List ||
      value.length != 2 ||
      value[0] is! num ||
      value[1] is! num) {
    throw const FormatException('route coordinate must be [lon, lat]');
  }
  final longitude = (value[0] as num).toDouble();
  final latitude = (value[1] as num).toDouble();
  if (!longitude.isFinite ||
      !latitude.isFinite ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90) {
    throw const FormatException('route coordinate is invalid');
  }
  return GeoPoint(longitude: longitude, latitude: latitude);
}

double _requiredNonNegativeNumber(Object? value) {
  if (value is! num || !value.isFinite || value < 0) {
    throw const FormatException('route metric must be non-negative');
  }
  return value.toDouble();
}

String _requiredString(Object? value) {
  if (value is! String || value.isEmpty) {
    throw const FormatException('route response is missing a required string');
  }
  return value;
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  if (value is! String) {
    throw const FormatException('route value must be a string');
  }
  return value;
}

Map<String, dynamic> _asMap(Object? value, String context) {
  if (value is! Map) throw FormatException('$context must be a map');
  return Map<String, dynamic>.fromEntries(
    value.entries.map((entry) => MapEntry(entry.key.toString(), entry.value)),
  );
}
