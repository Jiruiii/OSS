import 'map_models.dart';
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
  });

  final StaticFeature? feature;
  final String title;
  final String typeLabel;
  final GeoPoint coordinate;
  final String? region;
  final String? address;
  final String? resultId;

  String? get id => feature?.id ?? resultId;
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
  }) : _features = List<StaticFeature>.unmodifiable(features),
       _roadEntries = List<TaiwanSearchEntry>.unmodifiable(roadEntries);

  static const int maxResults = 8;

  final List<StaticFeature> _features;
  final List<TaiwanSearchEntry> _roadEntries;

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
      final score = _entryMatchScore(entry, normalized);
      if (score == null) continue;
      matches.add(
        _RankedResult(
          score: score,
          sourceIndex: _features.length + index,
          result: MapSearchResult(
            feature: null,
            title: entry.name,
            typeLabel: _typeLabelFor(entry.kind),
            coordinate: entry.coordinate,
            region: entry.region,
            resultId: entry.id,
          ),
        ),
      );
    }

    matches.sort((left, right) {
      final scoreOrder = left.score.compareTo(right.score);
      if (scoreOrder != 0) return scoreOrder;
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

int? _entryMatchScore(TaiwanSearchEntry entry, String query) => _matchScore(
  name: _normalizeText(entry.name),
  aliases: entry.aliases.map(_normalizeText),
  region: _normalizeText(entry.region),
  address: '',
  details: '',
  kind: _normalizeText(entry.kind),
  id: _normalizeText(entry.id),
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
  if (aliases.any((value) => value == query || value.contains(query))) {
    return 3;
  }
  if (region.contains(query)) return 4;
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
  });

  final int score;
  final int sourceIndex;
  final MapSearchResult result;
}
