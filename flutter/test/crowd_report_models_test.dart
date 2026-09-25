import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/crowd_report_models.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';

void main() {
  test('exposes the fixed crowd report wire values and labels', () {
    expect(
      CrowdReportCategory.values.map((value) => value.wireValue).toList(),
      <String>[
        'ROAD_BLOCKAGE',
        'FLOOD',
        'FIRE_SMOKE',
        'TRAPPED_INJURED',
        'OTHER',
      ],
    );
    expect(
      CrowdReportCategory.values.map((value) => value.label).toList(),
      <String>['道路阻斷', '淹水', '火災／煙霧', '受困／受傷', '其他'],
    );
    expect(
      CrowdReportLocationSource.values.map((value) => value.wireValue).toList(),
      <String>['CURRENT_LOCATION', 'MAP_PICK'],
    );
  });

  test('accepts empty descriptions and rejects the 161st code point', () {
    expect(CrowdReportDraft.validateDescription(''), isNull);
    expect(CrowdReportDraft.validateDescription(_repeat('災', 160)), isNull);
    expect(
      CrowdReportDraft.validateDescription(_repeat('災', 161)),
      '描述不可超過 160 字',
    );
  });

  test('serializes a trimmed report draft with lon-lat coordinates', () {
    const draft = CrowdReportDraft(
      category: CrowdReportCategory.roadBlockage,
      location: GeoPoint(longitude: 121.590304, latitude: 25.083506),
      locationSource: CrowdReportLocationSource.currentLocation,
      description: '  道路有落石  ',
    );

    expect(draft.validate(), isNull);
    expect(draft.toChannelArguments(), <String, Object?>{
      'category': 'ROAD_BLOCKAGE',
      'location': <String, Object?>{
        'lon': 121.590304,
        'lat': 25.083506,
        'source': 'CURRENT_LOCATION',
      },
      'description': '道路有落石',
    });
  });

  test(
    'serializes an address hint while keeping the final map-pick source',
    () {
      const draft = CrowdReportDraft(
        category: CrowdReportCategory.roadBlockage,
        location: GeoPoint(longitude: 121.590304, latitude: 25.083506),
        locationSource: CrowdReportLocationSource.mapPick,
        locationHint: CrowdReportLocationHint(
          query: '內湖區成功路',
          label: '成功路',
          kind: CrowdReportLocationHintKind.road,
          precision: CrowdReportLocationPrecision.road,
        ),
        description: '',
      );

      expect(draft.toChannelArguments(), <String, Object?>{
        'category': 'ROAD_BLOCKAGE',
        'location': <String, Object?>{
          'lon': 121.590304,
          'lat': 25.083506,
          'source': 'MAP_PICK',
        },
        'location_hint': <String, Object?>{
          'method': 'ADDRESS',
          'query': '內湖區成功路',
          'label': '成功路',
          'kind': 'ROAD',
          'precision': 'ROAD',
        },
        'description': '',
      });
    },
  );

  test('rejects a draft without a location or with invalid coordinates', () {
    const missingLocation = CrowdReportDraft(
      category: CrowdReportCategory.other,
      location: null,
      locationSource: null,
      description: '',
    );
    expect(missingLocation.validate(), '請選擇告警位置');
    expect(() => missingLocation.toChannelArguments(), throwsFormatException);

    const invalidLocation = CrowdReportDraft(
      category: CrowdReportCategory.other,
      location: GeoPoint(longitude: 181, latitude: 25),
      locationSource: CrowdReportLocationSource.mapPick,
      description: '',
    );
    expect(invalidLocation.validate(), '告警位置座標無效');
  });

  test('parses only the required unverified pending submission state', () {
    final submission = CrowdReportSubmission.fromMessage(<String, dynamic>{
      'event_id': 'report:test',
      'apply_state': 'UNVERIFIED',
      'delivery_state': 'PENDING',
    });

    expect(submission.eventId, 'report:test');
    expect(submission.applyState, 'UNVERIFIED');
    expect(submission.deliveryState, 'PENDING');

    expect(
      () => CrowdReportSubmission.fromMessage(<String, dynamic>{
        'event_id': 'report:test',
        'apply_state': 'CURRENT',
        'delivery_state': 'PENDING',
      }),
      throwsFormatException,
    );
    expect(
      () => CrowdReportSubmission.fromMessage(<String, dynamic>{
        'event_id': 'event:test',
        'apply_state': 'UNVERIFIED',
        'delivery_state': 'PENDING',
      }),
      throwsFormatException,
    );
  });
}

String _repeat(String value, int count) => List.filled(count, value).join();
