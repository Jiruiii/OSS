import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/map_search.dart';

void main() {
  final hospital = StaticFeature.fromJson(<String, dynamic>{
    'id': 'medical:1',
    'kind': 'medical',
    'name': 'Neihu General Hospital',
    'address': 'Taipei NEIHU Road 1',
    'facility_type': '醫院',
    'geometry': <String, dynamic>{
      'type': 'Point',
      'coordinates': <double>[121.59, 25.08],
    },
  });
  final shelter = StaticFeature.fromJson(<String, dynamic>{
    'id': 'shelter:2',
    'kind': 'shelter',
    'name': '潭美國小',
    'address': '內湖區新明路22號',
    'disaster_types': <String>['水災', '震災'],
    'available_count': null,
    'geometry': <String, dynamic>{
      'type': 'Point',
      'coordinates': <double>[121.58, 25.06],
    },
  });
  final road = StaticFeature.fromJson(<String, dynamic>{
    'id': 'osm:way:3',
    'kind': 'road',
    'name': 'Minquan East ROAD',
    'road_class': 'primary',
    'geometry': <String, dynamic>{
      'type': 'LineString',
      'coordinates': <dynamic>[
        <double>[121.56, 25.07],
        <double>[121.62, 25.09],
      ],
    },
  });

  test(
    'matches names and addresses case-insensitively using local features',
    () {
      final index = MapSearchIndex(<StaticFeature>[hospital, shelter, road]);

      expect(index.query('general HOSPITAL').single.feature, same(hospital));
      expect(index.query('taipei neihu').single.feature, same(hospital));
      expect(index.query('east road').single.feature, same(road));
    },
  );

  test('searches id, kind, and other detail values without changing nulls', () {
    final index = MapSearchIndex(<StaticFeature>[hospital, shelter, road]);

    expect(index.query('shelter:2').single.feature, same(shelter));
    expect(index.query('medical').single.feature, same(hospital));
    expect(index.query('震災').single.feature, same(shelter));
    expect(shelter.details['available_count'], isNull);
  });

  test(
    'returns display labels and focus coordinates for every supported kind',
    () {
      final results = MapSearchIndex(<StaticFeature>[
        hospital,
        shelter,
        road,
      ]).query('');

      expect(results, isEmpty);

      final hospitalResult = MapSearchIndex(<StaticFeature>[
        hospital,
      ]).query('n');
      expect(hospitalResult.single.typeLabel, '醫療院所');
      expect(hospitalResult.single.coordinate.longitude, 121.59);
      expect(hospitalResult.single.coordinate.latitude, 25.08);

      final shelterResult = MapSearchIndex(<StaticFeature>[
        shelter,
      ]).query('潭美');
      expect(shelterResult.single.typeLabel, '避難所');
      expect(shelterResult.single.coordinate.longitude, 121.58);

      final roadResult = MapSearchIndex(<StaticFeature>[road]).query('primary');
      expect(roadResult.single.typeLabel, '道路');
      expect(roadResult.single.coordinate.longitude, 121.59);
      expect(roadResult.single.coordinate.latitude, 25.08);
    },
  );

  test('returns at most eight tied matches in source order', () {
    final features = List<StaticFeature>.generate(
      10,
      (index) => StaticFeature.fromJson(<String, dynamic>{
        'id': 'road:$index',
        'kind': 'road',
        'name': '共同道路',
        'geometry': <String, dynamic>{
          'type': 'Point',
          'coordinates': <double>[121.56 + index / 1000, 25.07],
        },
      }),
    );

    final results = MapSearchIndex(features).query('共同');

    expect(results, hasLength(8));
    expect(results.map((result) => result.id), <String>[
      'road:0',
      'road:1',
      'road:2',
      'road:3',
      'road:4',
      'road:5',
      'road:6',
      'road:7',
    ]);
  });

  test('ignores whitespace-only queries and features without coordinates', () {
    final missingGeometry = StaticFeature.fromJson(<String, dynamic>{
      'id': 'medical:missing',
      'kind': 'medical',
      'name': '無座標醫院',
    });
    final index = MapSearchIndex(<StaticFeature>[hospital, missingGeometry]);

    expect(index.query('   '), isEmpty);
    expect(index.query('無座標'), isEmpty);
  });
}
