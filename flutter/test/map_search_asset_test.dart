import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
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
}
