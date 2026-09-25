import 'dart:math' as math;

import 'map_models.dart';

/// Administrative level used to decide which data points can be aggregated.
enum MapAdministrativeLevel { county, subdivision, village }

class MapAdministrativeArea {
  const MapAdministrativeArea({
    required this.key,
    required this.level,
    required this.name,
    required this.displayName,
    required this.parent,
    required this.point,
  });

  final String key;
  final MapAdministrativeLevel level;
  final String name;
  final String displayName;
  final String? parent;
  final GeoPoint point;
}

/// Nearest-label index shared by the map marker layer and the checked-in
/// Taiwan administrative label asset.
///
/// The label asset contains representative points rather than boundary
/// polygons. It is therefore used only to choose the display bucket; the
/// actual marker count still comes from the app-owned alert/facility data.
class MapAdministrativeIndex {
  const MapAdministrativeIndex({
    required this.counties,
    required this.subdivisions,
    required this.villages,
  });

  const MapAdministrativeIndex.empty()
    : counties = const <MapAdministrativeArea>[],
      subdivisions = const <MapAdministrativeArea>[],
      villages = const <MapAdministrativeArea>[];

  final List<MapAdministrativeArea> counties;
  final List<MapAdministrativeArea> subdivisions;
  final List<MapAdministrativeArea> villages;

  factory MapAdministrativeIndex.fromJson(Map<String, dynamic> json) {
    final rawFeatures = json['features'];
    if (rawFeatures is! List) return const MapAdministrativeIndex.empty();

    final counties = <MapAdministrativeArea>[];
    final subdivisions = <MapAdministrativeArea>[];
    final villages = <MapAdministrativeArea>[];
    for (final rawFeature in rawFeatures) {
      if (rawFeature is! Map) continue;
      final feature = Map<String, dynamic>.from(rawFeature);
      final properties = feature['properties'];
      final geometry = feature['geometry'];
      if (properties is! Map || geometry is! Map) continue;
      final coordinates = geometry['coordinates'];
      if (geometry['type'] != 'Point' ||
          coordinates is! List ||
          coordinates.length < 2) {
        continue;
      }
      final name = properties['name'];
      final labelType = properties['label_type'];
      if (name is! String || labelType is! String) continue;
      final longitude = _asDouble(coordinates[0]);
      final latitude = _asDouble(coordinates[1]);
      if (longitude == null || latitude == null) continue;

      final level = switch (labelType) {
        'city' => MapAdministrativeLevel.county,
        'district' || 'town' => MapAdministrativeLevel.subdivision,
        'village' => MapAdministrativeLevel.village,
        _ => null,
      };
      if (level == null) continue;
      final parent =
          properties['parent'] is String
              ? properties['parent'] as String
              : null;
      final displayName =
          properties['display_name'] is String
              ? properties['display_name'] as String
              : name;
      final area = MapAdministrativeArea(
        key: '${level.name}:$name:${parent ?? ''}',
        level: level,
        name: name,
        displayName: displayName,
        parent: parent,
        point: GeoPoint(longitude: longitude, latitude: latitude),
      );
      switch (level) {
        case MapAdministrativeLevel.county:
          counties.add(area);
        case MapAdministrativeLevel.subdivision:
          subdivisions.add(area);
        case MapAdministrativeLevel.village:
          villages.add(area);
      }
    }

    return MapAdministrativeIndex(
      counties: List.unmodifiable(counties),
      subdivisions: List.unmodifiable(subdivisions),
      villages: List.unmodifiable(villages),
    );
  }

  MapAdministrativeArea? nearest(
    GeoPoint point,
    MapAdministrativeLevel level, {
    String? parent,
  }) {
    final candidates = switch (level) {
      MapAdministrativeLevel.county => counties,
      MapAdministrativeLevel.subdivision => subdivisions,
      MapAdministrativeLevel.village => villages,
    };
    MapAdministrativeArea? nearestArea;
    var nearestDistance = double.infinity;
    for (final area in candidates) {
      if (parent != null && area.parent != parent) continue;
      final distance = _distanceSquared(point, area.point);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestArea = area;
      }
    }
    return nearestArea;
  }

  MapAdministrativeArea? findByName(
    MapAdministrativeLevel level,
    String name, {
    String? parent,
  }) {
    final candidates = switch (level) {
      MapAdministrativeLevel.county => counties,
      MapAdministrativeLevel.subdivision => subdivisions,
      MapAdministrativeLevel.village => villages,
    };
    for (final area in candidates) {
      if (parent != null && area.parent != parent) continue;
      if (area.name == name || area.displayName == name) return area;
    }
    return null;
  }

  MapAdministrativeArea? areaFor(GeoPoint point, MapAdministrativeLevel level) {
    if (level == MapAdministrativeLevel.county) {
      return nearest(point, level);
    }
    final county = nearest(point, MapAdministrativeLevel.county);
    final subdivision = nearest(
      point,
      MapAdministrativeLevel.subdivision,
      parent: county?.name,
    );
    if (level == MapAdministrativeLevel.subdivision || subdivision == null) {
      return subdivision ?? nearest(point, level);
    }
    return nearest(point, MapAdministrativeLevel.village);
  }
}

double _distanceSquared(GeoPoint left, GeoPoint right) {
  final latitudeRadians =
      ((left.latitude + right.latitude) / 2) * math.pi / 180;
  final longitudeDelta =
      (left.longitude - right.longitude) * math.cos(latitudeRadians);
  final latitudeDelta = left.latitude - right.latitude;
  return (longitudeDelta * longitudeDelta) + (latitudeDelta * latitudeDelta);
}

double? _asDouble(Object? value) =>
    value is num ? value.toDouble() : double.tryParse('$value');
