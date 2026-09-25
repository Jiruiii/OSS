import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:resilientgeo_flutter/data/map_administrative.dart';
import 'package:resilientgeo_flutter/data/map_search.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/map_search_asset.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('parses a versioned Taiwan search asset', () {
    final asset = TaiwanSearchAsset.fromJson(<String, dynamic>{
      'schema_version': '1',
      'dataset_id': 'taiwan-roads',
      'snapshot_at': '2026-09-22',
      'source_url': 'https://example.test/taiwan.osm.pbf',
      'source_sha256': 'a' * 64,
      'attribution': '© OpenStreetMap contributors',
      'entries': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'way:1',
          'name': '中山路',
          'aliases': <String>['中山路一段'],
          'kind': 'road',
          'region': '臺北市',
          'coordinate': <double>[121.52, 25.04],
        },
      ],
    });

    expect(asset.schemaVersion, '1');
    expect(asset.datasetId, 'taiwan-roads');
    expect(asset.entries, hasLength(1));
    expect(
      asset.entries.single.coordinate,
      const GeoPoint(longitude: 121.52, latitude: 25.04),
    );
  });

  test('rejects an asset with a malformed coordinate', () {
    expect(
      () => TaiwanSearchAsset.fromJson(<String, dynamic>{
        'schema_version': '1',
        'dataset_id': 'taiwan-roads',
        'snapshot_at': '2026-09-22',
        'source_url': 'https://example.test/taiwan.osm.pbf',
        'source_sha256': 'a' * 64,
        'attribution': '© OpenStreetMap contributors',
        'entries': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'way:1',
            'name': '壞資料',
            'aliases': <String>[],
            'kind': 'road',
            'region': '臺北市',
            'coordinate': <double>[121.52],
          },
        ],
      }),
      throwsFormatException,
    );
  });

  test(
    'loads the bundled all-Taiwan road index and searches a known road',
    () async {
      final document = await rootBundle.loadString(
        'assets/map/search/taiwan-roads.json',
      );
      final asset = TaiwanSearchAsset.fromJson(jsonDecode(document));

      expect(asset.datasetId, 'taiwan-roads');
      expect(
        asset.sourceUrl,
        contains('geofabrik.de/asia/taiwan-latest.osm.pbf'),
      );
      expect(asset.entries, isNotEmpty);
      final results = MapSearchIndex(
        const [],
        roadEntries: asset.entries,
      ).query('中山路');
      expect(results, isNotEmpty);
      expect(results.every((result) => result.feature == null), isTrue);
    },
  );

  test(
    'searches the bundled address with its road name before area context',
    () async {
      final roadDocument = await rootBundle.loadString(
        'assets/map/search/taiwan-roads.json',
      );
      final labelDocument = await rootBundle.loadString(
        'assets/map/labels/taiwan-reference-labels.geojson',
      );
      final roadAsset = TaiwanSearchAsset.fromJson(jsonDecode(roadDocument));
      final labelJson = jsonDecode(labelDocument);
      final administrativeIndex = MapAdministrativeIndex.fromJson(
        Map<String, dynamic>.from(labelJson as Map),
      );

      final results = MapSearchIndex(
        const [],
        roadEntries: roadAsset.entries,
        administrativeAreas: administrativeIndex.searchableAreas,
      ).query('新北市三重區萬全街');
      final roadResults = results.where(
        (result) => result.searchKind == 'road',
      );

      expect(roadResults, isNotEmpty);
      expect(roadResults.every((result) => result.title == '萬全街'), isTrue);
    },
  );

  test(
    'ranks a same-name road near the requested administrative area first',
    () async {
      final roadDocument = await rootBundle.loadString(
        'assets/map/search/taiwan-roads.json',
      );
      final labelDocument = await rootBundle.loadString(
        'assets/map/labels/taiwan-reference-labels.geojson',
      );
      final roadAsset = TaiwanSearchAsset.fromJson(jsonDecode(roadDocument));
      final labelJson = jsonDecode(labelDocument);
      final administrativeIndex = MapAdministrativeIndex.fromJson(
        Map<String, dynamic>.from(labelJson as Map),
      );

      final roadResults = MapSearchIndex(
        const [],
        roadEntries: roadAsset.entries,
        administrativeAreas: administrativeIndex.searchableAreas,
      ).query('新北市三重區長安街').where((result) => result.searchKind == 'road');

      expect(roadResults, isNotEmpty);
      expect(roadResults.first.resultId, 'way:244536321');
    },
  );
}
