/// UI-independent map data types shared by static assets and Android events.
class GeoPoint {
  const GeoPoint({required this.longitude, required this.latitude});

  final double longitude;
  final double latitude;
}

sealed class MapGeometry {
  const MapGeometry();

  static MapGeometry? fromJson(Object? value) {
    final json = _asStringMap(value);
    if (json == null) return null;

    switch (json['type']) {
      case 'Point':
        final point = _pointFromCoordinates(json['coordinates']);
        return point == null ? null : PointGeometry(point);
      case 'LineString':
        final points = _pointsFromCoordinates(json['coordinates']);
        return points == null ? null : LineStringGeometry(points);
      case 'Polygon':
        final rings = _ringsFromCoordinates(json['coordinates']);
        return rings == null ? null : PolygonGeometry(rings);
      default:
        return null;
    }
  }
}

final class PointGeometry extends MapGeometry {
  const PointGeometry(this.point);

  final GeoPoint point;
}

final class LineStringGeometry extends MapGeometry {
  const LineStringGeometry(this.points);

  final List<GeoPoint> points;
}

final class PolygonGeometry extends MapGeometry {
  const PolygonGeometry(this.rings);

  final List<List<GeoPoint>> rings;
}

class StaticFeatureCollection {
  const StaticFeatureCollection({
    required this.schemaVersion,
    required this.datasetId,
    required this.snapshotAt,
    required this.features,
  });

  final String? schemaVersion;
  final String? datasetId;
  final String? snapshotAt;
  final List<StaticFeature> features;

  factory StaticFeatureCollection.fromJson(Map<String, dynamic> json) {
    final sourceFeatures = json['features'];
    final features =
        sourceFeatures is List
            ? sourceFeatures
                .map(_asStringMap)
                .whereType<Map<String, dynamic>>()
                .map(StaticFeature.fromJson)
                .toList(growable: false)
            : const <StaticFeature>[];

    return StaticFeatureCollection(
      schemaVersion: _asString(json['schema_version']),
      datasetId: _asString(json['dataset_id']),
      snapshotAt: _asString(json['snapshot_at']),
      features: features,
    );
  }
}

class StaticFeature {
  const StaticFeature({
    required this.id,
    required this.kind,
    required this.geometry,
    required this.properties,
  });

  final String? id;
  final String? kind;
  final MapGeometry? geometry;
  final Map<String, dynamic>? properties;

  factory StaticFeature.fromJson(Map<String, dynamic> json) => StaticFeature(
    id: _asString(json['id']),
    kind: _asString(json['kind']),
    geometry: MapGeometry.fromJson(json['geometry']),
    properties: _asStringMap(json['properties']),
  );
}

class MeshEvent {
  const MeshEvent({
    required this.namespace,
    required this.eventId,
    required this.eventVersion,
    required this.eventType,
    required this.severity,
    required this.source,
    required this.issuedAt,
    required this.expiresAt,
    required this.applyState,
    required this.geometry,
    required this.attributes,
  });

  final String? namespace;
  final String? eventId;
  final int? eventVersion;
  final String? eventType;
  final String? severity;
  final String? source;
  final String? issuedAt;
  final String? expiresAt;
  final String? applyState;
  final MapGeometry? geometry;
  final Map<String, dynamic>? attributes;

  factory MeshEvent.fromJson(Map<String, dynamic> json) => MeshEvent(
    namespace: _asString(json['namespace']),
    eventId: _asString(json['event_id']),
    eventVersion: _asInt(json['event_version']),
    eventType: _asString(json['event_type']),
    severity: _asString(json['severity']),
    source: _asString(json['source']),
    issuedAt: _asString(json['issued_at']),
    expiresAt: _asString(json['expires_at']),
    applyState: _asString(json['apply_state']),
    geometry: MapGeometry.fromJson(json['geometry']),
    attributes: _asStringMap(json['attributes']),
  );

  bool get isExpired {
    if (applyState == 'EXPIRED') return true;
    final expiresAtValue = expiresAt;
    if (expiresAtValue == null) return false;
    final expiry = DateTime.tryParse(expiresAtValue);
    return expiry != null && expiry.isBefore(DateTime.now().toUtc());
  }
}

class MapInitialState {
  const MapInitialState({
    required this.events,
    required this.emergencyModeEnabled,
  });

  final List<MeshEvent> events;
  final bool emergencyModeEnabled;

  factory MapInitialState.fromJson(Map<String, dynamic> json) =>
      MapInitialState(
        events: _eventsFromValue(json['events']),
        emergencyModeEnabled:
            json['emergency_mode_enabled'] is bool
                ? json['emergency_mode_enabled'] as bool
                : false,
      );
}

class FixtureLoadSummary {
  const FixtureLoadSummary({
    required this.processed,
    required this.inserted,
    required this.updated,
    required this.rejected,
  });

  final int? processed;
  final int? inserted;
  final int? updated;
  final int? rejected;

  factory FixtureLoadSummary.fromJson(Map<String, dynamic> json) =>
      FixtureLoadSummary(
        processed: _asInt(json['processed']),
        inserted: _asInt(json['inserted']),
        updated: _asInt(json['updated']),
        rejected: _asInt(json['rejected']),
      );
}

List<MeshEvent> eventsFromMessage(Object? value) => _eventsFromValue(value);

List<MeshEvent> _eventsFromValue(Object? value) {
  if (value is! List) return const <MeshEvent>[];
  return value
      .map(_asStringMap)
      .whereType<Map<String, dynamic>>()
      .map(MeshEvent.fromJson)
      .toList(growable: false);
}

Map<String, dynamic>? mapFromMessage(Object? value) => _asStringMap(value);

Map<String, dynamic>? _asStringMap(Object? value) {
  if (value is! Map) return null;
  return Map<String, dynamic>.fromEntries(
    value.entries.map((entry) => MapEntry(entry.key.toString(), entry.value)),
  );
}

String? _asString(Object? value) => value is String ? value : null;

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is num && value == value.roundToDouble()) return value.toInt();
  return value is String ? int.tryParse(value) : null;
}

double? _asDouble(Object? value) {
  if (value is num) return value.toDouble();
  return value is String ? double.tryParse(value) : null;
}

GeoPoint? _pointFromCoordinates(Object? value) {
  if (value is! List || value.length < 2) return null;
  final longitude = _asDouble(value[0]);
  final latitude = _asDouble(value[1]);
  if (longitude == null || latitude == null) return null;
  return GeoPoint(longitude: longitude, latitude: latitude);
}

List<GeoPoint>? _pointsFromCoordinates(Object? value) {
  if (value is! List) return null;
  final points = value.map(_pointFromCoordinates).toList(growable: false);
  if (points.any((point) => point == null)) return null;
  return points.cast<GeoPoint>();
}

List<List<GeoPoint>>? _ringsFromCoordinates(Object? value) {
  if (value is! List) return null;
  final rings = value.map(_pointsFromCoordinates).toList(growable: false);
  if (rings.any((ring) => ring == null)) return null;
  return rings.cast<List<GeoPoint>>();
}
