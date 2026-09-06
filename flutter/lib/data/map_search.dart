import 'map_models.dart';

class MapSearchResult {
  const MapSearchResult({
    required this.feature,
    required this.title,
    required this.typeLabel,
    required this.coordinate,
  });

  final StaticFeature feature;
  final String title;
  final String typeLabel;
  final GeoPoint coordinate;

  String? get id => feature.id;
}

/// Synchronous index over bundled map features. It has no network dependency.
class MapSearchIndex {
  MapSearchIndex(List<StaticFeature> features)
    : _features = List<StaticFeature>.unmodifiable(features);

  static const int maxResults = 8;

  final List<StaticFeature> _features;

  List<MapSearchResult> query(String text) {
    final query = text.trim().toLowerCase();
    if (query.isEmpty) return const <MapSearchResult>[];

    final matches = <_RankedResult>[];
    for (var index = 0; index < _features.length; index += 1) {
      final feature = _features[index];
      final coordinate = _focusCoordinate(feature.geometry);
      if (coordinate == null) continue;

      final score = _matchScore(feature, query);
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
          ),
        ),
      );
    }

    matches.sort((left, right) {
      final scoreOrder = left.score.compareTo(right.score);
      return scoreOrder != 0
          ? scoreOrder
          : left.sourceIndex.compareTo(right.sourceIndex);
    });
    return matches
        .take(maxResults)
        .map((match) => match.result)
        .toList(growable: false);
  }
}

int? _matchScore(StaticFeature feature, String query) {
  final details = feature.details;
  final name = _searchText(details['name']);
  if (name == query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.contains(query)) return 2;

  final address = _searchText(details['address']);
  if (address.contains(query)) return 3;
  if (_searchText(feature.kind) == query) return 4;
  if (_searchText(feature.id).contains(query)) return 5;

  final detailsText = details.values.map(_searchText).join(' ');
  return detailsText.contains(query) ? 6 : null;
}

String _searchText(Object? value) {
  if (value == null) return '';
  if (value is Iterable) return value.map(_searchText).join(' ').toLowerCase();
  if (value is Map) {
    return value.values.map(_searchText).join(' ').toLowerCase();
  }
  return value.toString().toLowerCase();
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
