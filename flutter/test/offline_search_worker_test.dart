import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/offline_search_worker.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

void main() {
  test(
    'background index preserves roads and updated facility searches',
    () async {
      final worker = await OfflineSearchWorker.start(
        jsonEncode({
          'schema_version': '1',
          'dataset_id': 'test',
          'snapshot_at': '2026-09-25',
          'source_url': 'fixture',
          'source_sha256': List.filled(64, 'a').join(),
          'attribution': 'OSM',
          'entries': [
            {
              'id': 'road:1',
              'name': '成功路',
              'aliases': [],
              'kind': 'road',
              'region': '內湖區',
              'coordinate': [121.59, 25.08],
            },
          ],
        }),
      );
      addTearDown(worker.close);
      expect((await worker.search('成功路')).results.single.id, 'road:1');
      worker.update([
        StaticFeature.fromJson({
          'id': 'shelter:1',
          'kind': 'shelter',
          'name': '測試學校',
          'geometry': {
            'type': 'Point',
            'coordinates': [121.59, 25.08],
          },
        }),
      ], []);
      expect((await worker.search('測試學校')).results.single.id, 'shelter:1');
      expect((await worker.search('成功路')).results.single.id, 'road:1');
      worker.close();
      await expectLater(worker.search('學校'), throwsStateError);
    },
  );

  test(
    'malformed search data fails without leaving a worker running',
    () async {
      await expectLater(OfflineSearchWorker.start('{}'), throwsFormatException);
    },
  );
}
