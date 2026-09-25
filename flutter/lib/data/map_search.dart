import 'dart:math' as math;

import 'map_models.dart';
import 'map_administrative.dart';
import 'map_search_asset.dart';

class MapSearchResult {
  const MapSearchResult({
    required this.feature,
    required this.title,
    required this.typeLabel,
    required this.coordinate,
    this.region,
    this.address,
    this.resultId,
    this.searchKind,
  });

  final StaticFeature? feature;
  final String title;
  final String typeLabel;
  final GeoPoint coordinate;
  final String? region;
  final String? address;
  final String? resultId;
  final String? searchKind;

  String? get id => feature?.id ?? resultId;

  /// Includes a locally inferred administrative context for road results.
  /// It is a display label, not an authoritative street address.
  String get displayTitle {
    final isRoad = searchKind == 'road' || feature?.kind == 'road';
    final context = region?.trim();
    if (!isRoad || context == null || context.isEmpty) return title;
    if (title.startsWith(context)) return title;
    return '$context・$title';
  }
}

class MapSearchQuery {
  const MapSearchQuery({
    required this.input,
    required this.results,
    this.coordinate,
  });

  final String input;
  final List<MapSearchResult> results;
  final GeoPoint? coordinate;

  bool get isCoordinate => coordinate != null;
}

/// Synchronous index over bundled map features. It has no network dependency.
class MapSearchIndex {
  MapSearchIndex(
    List<StaticFeature> features, {
    Iterable<TaiwanSearchEntry> roadEntries = const <TaiwanSearchEntry>[],
    Iterable<MapAdministrativeArea> administrativeAreas =
        const <MapAdministrativeArea>[],
  }) : _features = List<StaticFeature>.unmodifiable(features),
       _roadEntries = List<TaiwanSearchEntry>.unmodifiable(roadEntries),
       _administrativeAreas = List<MapAdministrativeArea>.unmodifiable(
         administrativeAreas,
       );

  static const int maxResults = 8;

  final List<StaticFeature> _features;
  final List<TaiwanSearchEntry> _roadEntries;
  final List<MapAdministrativeArea> _administrativeAreas;
  late final MapAdministrativeIndex _administrativeLabelIndex =
      MapAdministrativeIndex(
        counties: _administrativeAreas
            .where((area) => area.level == MapAdministrativeLevel.county)
            .toList(growable: false),
        subdivisions: _administrativeAreas
            .where((area) => area.level == MapAdministrativeLevel.subdivision)
            .toList(growable: false),
        villages: _administrativeAreas
            .where((area) => area.level == MapAdministrativeLevel.village)
            .toList(growable: false),
      );

  MapSearchQuery search(String text) {
    final input = text.trim();
    final normalized = _normalizeText(input);
    if (normalized.isEmpty) {
      return MapSearchQuery(input: input, results: const <MapSearchResult>[]);
    }

    if (_looksLikeCoordinateQuery(input)) {
      final coordinate = parseTaiwanCoordinate(input);
      if (coordinate == null) {
        return MapSearchQuery(input: input, results: const <MapSearchResult>[]);
      }
      final result = MapSearchResult(
        feature: null,
        title: input,
        typeLabel: '經緯度',
        coordinate: coordinate,
        resultId: 'coordinate:${coordinate.latitude},${coordinate.longitude}',
      );
      return MapSearchQuery(
        input: input,
        coordinate: coordinate,
        results: <MapSearchResult>[result],
      );
    }

    final requestedArea = _requestedAdministrativeAreaFor(normalized);
    final matches = <_RankedResult>[];
    for (var index = 0; index < _features.length; index += 1) {
      final feature = _features[index];
      final coordinate = _focusCoordinate(feature.geometry);
      if (coordinate == null) continue;
      final score = _featureMatchScore(feature, normalized);
      if (score == null) continue;
      matches.add(
        _RankedResult(
          score: score,
          sourceIndex: index,
          result: MapSearchResult(
            feature: feature,
            title: _titleFor(feature),
            typeLabel: _typeLabelFor(feature.kind),
            coordinate: coordinate,
            region: _regionFor(feature),
            address: _addressFor(feature),
          ),
        ),
      );
    }

    for (var index = 0; index < _roadEntries.length; index += 1) {
      final entry = _roadEntries[index];
      final baseScore = _entryMatchScore(entry, normalized);
      if (baseScore == null) continue;
      final nameMatches = _entryNameMatches(entry, normalized);
      final region =
          entry.region ??
          (nameMatches ? _administrativeContextFor(entry.coordinate) : null);
      final score = _prioritizedEntryScore(
        entry,
        normalized,
        baseScore,
        region,
      );
      matches.add(
        _RankedResult(
          score: score,
          sourceIndex: _features.length + index,
          proximity:
              requestedArea != null && nameMatches
                  ? _distanceSquared(entry.coordinate, requestedArea.point)
                  : null,
          result: MapSearchResult(
            feature: null,
            title: entry.name,
            typeLabel: _typeLabelFor(entry.kind),
            coordinate: entry.coordinate,
            region: region,
            resultId: entry.id,
            searchKind: entry.kind,
          ),
        ),
      );
    }

    for (var index = 0; index < _administrativeAreas.length; index += 1) {
      final area = _administrativeAreas[index];
      final score = _administrativeMatchScore(area, normalized);
      if (score == null) continue;
      matches.add(
        _RankedResult(
          score: score,
          sourceIndex: _features.length + _roadEntries.length + index,
          result: MapSearchResult(
            feature: null,
            title: area.displayName,
            typeLabel: _administrativeTypeLabel(area.level),
            coordinate: area.point,
            region: area.parent,
            resultId: area.key,
            searchKind: area.level.name,
          ),
        ),
      );
    }

    matches.sort((left, right) {
      final scoreOrder = left.score.compareTo(right.score);
      if (scoreOrder != 0) return scoreOrder;
      if (left.proximity != null && right.proximity != null) {
        final proximityOrder = left.proximity!.compareTo(right.proximity!);
        if (proximityOrder != 0) return proximityOrder;
      }
      final sourceOrder = left.sourceIndex.compareTo(right.sourceIndex);
      if (sourceOrder != 0) return sourceOrder;
      return (left.result.id ?? '').compareTo(right.result.id ?? '');
    });
    return MapSearchQuery(
      input: input,
      results: matches
          .take(maxResults)
          .map((match) => match.result)
          .toList(growable: false),
    );
  }

  List<MapSearchResult> query(String text) => search(text).results;

  String? _administrativeContextFor(GeoPoint point) {
    if (_administrativeAreas.isEmpty) return null;
    return _administrativeLabelIndex.contextLabelFor(point);
  }

  MapAdministrativeArea? _requestedAdministrativeAreaFor(String query) {
    MapAdministrativeArea? bestMatch;
    var bestScore = -1;
    for (final area in _administrativeAreas) {
      final name = _normalizeText(area.name);
      if (name.length < 2 || !query.contains(name)) continue;

      final parent = _normalizeText(area.parent);
      final parentMatches = parent.isNotEmpty && query.contains(parent);
      final levelScore = switch (area.level) {
        MapAdministrativeLevel.county => 1,
        MapAdministrativeLevel.subdivision => 2,
        MapAdministrativeLevel.village => 3,
      };
      final score =
          (parentMatches ? 10000 : 0) + (levelScore * 100) + name.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = area;
      }
    }
    return bestMatch;
  }
}

int? _featureMatchScore(StaticFeature feature, String query) {
  final details = feature.details;
  final name = _searchText(details['name']);
  final aliases = _stringValues(details['aliases']);
  final region = _regionFor(feature);
  final address = _addressFor(feature);
  return _matchScore(
    name: name,
    aliases: aliases,
    region: _searchText(region),
    address: _searchText(address),
    details: _searchText(details),
    kind: _searchText(feature.kind),
    id: _searchText(feature.id),
    query: query,
  );
}

int? _entryMatchScore(TaiwanSearchEntry entry, String query) {
  final sourceRegion = _normalizeText(entry.region);
  final score = _matchScore(
    name: _normalizeText(entry.name),
    aliases: entry.aliases.map(_normalizeText),
    region: sourceRegion,
    address: '',
    details: '',
    kind: _normalizeText(entry.kind),
    id: _normalizeText(entry.id),
    query: query,
  );
  if (score == null) return null;

  // A source region alone may match an administrative part of a longer
  // address, but it must not make every road in that region a result.
  if (score == 4 && sourceRegion != query && !_entryNameMatches(entry, query)) {
    return null;
  }
  return score;
}

int _prioritizedEntryScore(
  TaiwanSearchEntry entry,
  String query,
  int baseScore,
  String? displayRegion,
) {
  final normalizedRegion = _normalizeText(displayRegion);
  // If the user supplied the local context, prefer same-name roads in that
  // context over same-name roads elsewhere in the bundled index. The name
  // match was already checked before this context was derived.
  if (normalizedRegion.length >= 2 &&
      query.contains(normalizedRegion) &&
      _entryNameMatches(entry, query) &&
      baseScore > 1) {
    return 1;
  }
  return baseScore;
}

bool _entryNameMatches(TaiwanSearchEntry entry, String query) {
  final name = _normalizeText(entry.name);
  if (_valueMatches(name, query)) return true;
  return entry.aliases.any(
    (alias) => _valueMatches(_normalizeText(alias), query),
  );
}

bool _valueMatches(String value, String query) {
  if (value == query || value.startsWith(query) || value.contains(query)) {
    return true;
  }
  return value.length >= 2 && query.contains(value);
}

int? _administrativeMatchScore(MapAdministrativeArea area, String query) =>
    _matchScore(
      name: _normalizeText(area.displayName),
      aliases: <String>[area.name].map(_normalizeText),
      region: _normalizeText(area.parent),
      address: '',
      details: '',
      kind: _normalizeText(area.level.name),
      id: _normalizeText(area.key),
      query: query,
    );

int? _matchScore({
  required String name,
  required Iterable<String> aliases,
  required String region,
  required String address,
  required String details,
  required String kind,
  required String id,
  required String query,
}) {
  if (name == query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.contains(query)) return 2;
  if (name.length >= 2 && query.contains(name)) return 2;
  if (aliases.any((value) => value == query || value.contains(query))) {
    return 3;
  }
  if (aliases.any((value) => value.length >= 2 && query.contains(value))) {
    return 3;
  }
  if (region.contains(query)) return 4;
  if (region.length >= 2 && query.contains(region)) return 4;
  if (address.contains(query) || details.contains(query)) return 5;
  if (kind.contains(query)) return 6;
  if (id.contains(query)) return 7;
  return null;
}

String _normalizeText(Object? value) {
  if (value == null) return '';
  return value.toString().toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
}

String _searchText(Object? value) {
  if (value is Iterable) return value.map(_searchText).join(' ');
  if (value is Map) return value.values.map(_searchText).join(' ');
  return _normalizeText(value);
}

List<String> _stringValues(Object? value) {
  if (value is! Iterable) return const <String>[];
  return value.map(_normalizeText).where((value) => value.isNotEmpty).toList();
}

String _titleFor(StaticFeature feature) {
  final name = feature.details['name'];
  if (name is String && name.trim().isNotEmpty) return name.trim();
  return feature.id ?? _typeLabelFor(feature.kind);
}

String _typeLabelFor(String? kind) => switch (kind) {
  'medical' => '醫療院所',
  'shelter' => '避難所',
  'road' => '道路',
  _ => kind ?? '其他',
};

String _administrativeTypeLabel(MapAdministrativeLevel level) =>
    switch (level) {
      MapAdministrativeLevel.county => '縣市',
      MapAdministrativeLevel.subdivision => '行政區',
      MapAdministrativeLevel.village => '里',
    };

String? _regionFor(StaticFeature feature) {
  for (final key in <String>['region', 'county', 'city', 'district']) {
    final value = feature.details[key];
    if (value is String && value.trim().isNotEmpty) return value.trim();
  }
  return null;
}

String? _addressFor(StaticFeature feature) {
  final value = feature.details['address'];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}

bool _looksLikeCoordinateQuery(String text) {
  if (text.contains(',')) return true;
  final parts = text.split(RegExp(r'\s+'));
  return parts.length == 2 &&
      parts.every((part) => double.tryParse(part) != null);
}

GeoPoint? _focusCoordinate(MapGeometry? geometry) {
  final points = switch (geometry) {
    PointGeometry(:final point) => <GeoPoint>[point],
    LineStringGeometry(:final points) => points,
    PolygonGeometry(:final rings) => rings.expand((ring) => ring).toList(),
    _ => const <GeoPoint>[],
  };
  if (points.isEmpty) return null;

  var minLongitude = points.first.longitude;
  var maxLongitude = points.first.longitude;
  var minLatitude = points.first.latitude;
  var maxLatitude = points.first.latitude;
  for (final point in points.skip(1)) {
    minLongitude =
        point.longitude < minLongitude ? point.longitude : minLongitude;
    maxLongitude =
        point.longitude > maxLongitude ? point.longitude : maxLongitude;
    minLatitude = point.latitude < minLatitude ? point.latitude : minLatitude;
    maxLatitude = point.latitude > maxLatitude ? point.latitude : maxLatitude;
  }
  return GeoPoint(
    longitude: (minLongitude + maxLongitude) / 2,
    latitude: (minLatitude + maxLatitude) / 2,
  );
}

class _RankedResult {
  const _RankedResult({
    required this.score,
    required this.sourceIndex,
    required this.result,
    this.proximity,
  });

  final int score;
  final int sourceIndex;
  final MapSearchResult result;
  final double? proximity;
}

double _distanceSquared(GeoPoint left, GeoPoint right) {
  final latitudeRadians =
      ((left.latitude + right.latitude) / 2) * math.pi / 180;
  final longitudeDelta =
      (left.longitude - right.longitude) * math.cos(latitudeRadians);
  final latitudeDelta = left.latitude - right.latitude;
  return (longitudeDelta * longitudeDelta) + (latitudeDelta * latitudeDelta);
}
