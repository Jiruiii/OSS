import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_administrative.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/map_zoom.dart';
import 'package:resilientgeo_flutter/data/maplibre_map_config.dart';
import 'package:resilientgeo_flutter/widgets/map_layers.dart';

void main() {
  test('uses compact marker bounds and keeps the tap action on the marker', () {
    var tapped = false;
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) => tapped = true,
      onEventSelected: (_) {},
    );

    expect(markers, hasLength(1));
    expect(markers.single.width, 28);
    expect(markers.single.height, 28);

    markers.single.onTap();
    expect(tapped, isTrue);
  });

  test('hit-tests a marker using its projected screen position', () {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
    );

    final hits = hitTestMapMarkers(
      markers: markers,
      positions: <Key, Offset>{markers.single.key: const Offset(100, 80)},
      point: const Offset(114, 94),
    );

    expect(hits, contains(markers.single));
  });

  test('does not hit a marker outside its compact bounds', () {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
    );

    final hits = hitTestMapMarkers(
      markers: markers,
      positions: <Key, Offset>{markers.single.key: const Offset(100, 80)},
      point: const Offset(117, 97),
    );

    expect(hits, isEmpty);
  });

  test('groups nearby facilities into one data cluster at overview zoom', () {
    GeoPoint? clusterPoint;
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (point, {targetZoom}) => clusterPoint = point,
      zoom: 6.5,
    );

    expect(markers, hasLength(1));
    expect(markers.single.kind, MapMarkerKind.cluster);
    expect(markers.single.itemCount, 2);

    markers.single.onTap();
    expect(clusterPoint, isNotNull);
  });

  test('keeps a zoomed cluster count inside a compact bubble', () {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      zoom: 6.5,
      zoomPercentage: 25,
    );

    expect(markers.single.kind, MapMarkerKind.cluster);
    expect(markers.single.width, lessThanOrEqualTo(26));
    expect(markers.single.height, lessThanOrEqualTo(26));
  });

  testWidgets('overview cluster is a small dot without a count', (
    tester,
  ) async {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      zoom: 6.5,
      zoomPercentage: 0,
    );

    expect(markers.single.kind, MapMarkerKind.cluster);
    expect(markers.single.width, lessThanOrEqualTo(18));

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(width: 80, height: 80, child: markers.single.child),
      ),
    );

    expect(find.text('2'), findsNothing);
  });

  testWidgets('county cluster count appears from twenty-five percent', (
    tester,
  ) async {
    final hiddenMarkers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      zoom: 6.5,
      zoomPercentage: 10,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 80,
          height: 80,
          child: hiddenMarkers.single.child,
        ),
      ),
    );

    expect(find.text('2'), findsNothing);

    final visibleMarkers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      zoom: 6.5,
      zoomPercentage: 25,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 80,
          height: 80,
          child: visibleMarkers.single.child,
        ),
      ),
    );

    expect(find.text('2'), findsOneWidget);
  });

  test(
    'large cluster size is capped instead of scaling with the full count',
    () {
      final features = List<StaticFeature>.generate(
        30,
        (index) => _feature('clustered-$index', 121.5 + index * 0.0001, 25.0),
      );
      final markers = MapLayers.buildMarkers(
        features: features,
        events: const <MeshEvent>[],
        showShelters: true,
        showMedical: false,
        showEvents: false,
        onStaticFeatureSelected: (_) {},
        onEventSelected: (_) {},
        onClusterSelected: (_, {targetZoom}) {},
        zoom: 6.5,
        zoomPercentage: 25,
      );

      expect(markers, hasLength(1));
      expect(markers.single.itemCount, 30);
      expect(markers.single.width, lessThanOrEqualTo(30));
      expect(markers.single.height, lessThanOrEqualTo(30));
    },
  );

  test('splits distant facilities when zoomed in', () {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _medical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      zoom: 15,
    );

    expect(markers, hasLength(2));
    expect(
      markers.every((marker) => marker.kind != MapMarkerKind.cluster),
      isTrue,
    );
  });

  test('shows every nearby data marker from the 55 percent zoom level', () {
    final revealAllZoom = ZoomPercentage.toZoom(
      percentage: MapLibreMapConfig.revealAllPercentage,
      minZoom: MapLibreMapConfig.minZoom,
      maxZoom: MapLibreMapConfig.maxZoom,
      overviewZoom: MapLibreMapConfig.overviewZoom,
    );
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _nearbyMedical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      revealAllAtZoom: revealAllZoom,
      zoom: revealAllZoom + 0.01,
    );

    expect(markers, hasLength(2));
    expect(
      markers.every((marker) => marker.kind != MapMarkerKind.cluster),
      isTrue,
    );
  });

  test(
    'uses the displayed 55 percent threshold to reveal raw data markers',
    () {
      final markers = MapLayers.buildMarkers(
        features: const <StaticFeature>[_shelter, _nearbyMedical],
        events: const <MeshEvent>[],
        showShelters: true,
        showMedical: true,
        showEvents: false,
        onStaticFeatureSelected: (_) {},
        onEventSelected: (_) {},
        onClusterSelected: (_, {targetZoom}) {},
        revealAllAtZoom: 15.2,
        zoom: 14,
        zoomPercentage: MapLibreMapConfig.revealAllPercentage,
      );

      expect(markers, hasLength(2));
      expect(
        markers.every((marker) => marker.kind == MapMarkerKind.facility),
        isTrue,
      );
    },
  );

  test('uses dots at 55 percent and smaller full icons at 80 percent', () {
    var selected = false;
    final dots = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _nearbyMedical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) => selected = true,
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      revealAllAtZoom: 15.2,
      zoom: 14,
      zoomPercentage: MapLibreMapConfig.revealAllPercentage,
    );

    expect(dots, hasLength(2));
    expect(
      dots.every((marker) => marker.kind == MapMarkerKind.facility),
      isTrue,
    );
    expect(dots.every((marker) => marker.width == 18), isTrue);
    expect(dots.every((marker) => marker.height == 18), isTrue);
    dots.first.onTap();
    expect(selected, isTrue);

    final icons = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _nearbyMedical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      revealAllAtZoom: 15.2,
      zoom: 15,
      zoomPercentage: MapLibreMapConfig.fullMarkerPercentage,
    );

    expect(icons, hasLength(2));
    expect(
      icons.every((marker) => marker.kind == MapMarkerKind.facility),
      isTrue,
    );
    expect(icons.every((marker) => marker.width == 28), isTrue);
    expect(icons.every((marker) => marker.height == 28), isTrue);
  });

  test('does not recreate a cluster at the maximum zoom', () {
    final markers = MapLayers.buildMarkers(
      features: const <StaticFeature>[_shelter, _nearbyMedical],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      revealAllAtZoom: 15.2,
      zoom: 17,
    );

    expect(markers, hasLength(2));
    expect(
      markers.every((marker) => marker.kind != MapMarkerKind.cluster),
      isTrue,
    );
  });

  test('groups data by city and advances to the next administrative level', () {
    double? nextZoom;
    final index = MapAdministrativeIndex.fromJson(<String, dynamic>{
      'features': <Map<String, dynamic>>[
        _label('甲市', 'city', 121.5, 25.0),
        _label('乙市', 'city', 120.0, 25.0),
        _label('甲一區', 'district', 121.5, 25.0, parent: '甲市'),
        _label('甲二區', 'district', 121.0, 25.0, parent: '甲市'),
      ],
    });
    final first = _feature('facility-1', 121.0, 25.0);
    final second = _feature('facility-2', 122.0, 25.0);
    final third = _feature('facility-3', 120.0, 25.0);

    final markers = MapLayers.buildMarkers(
      features: <StaticFeature>[first, second, third],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) => nextZoom = targetZoom,
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 6.5,
    );

    expect(markers, hasLength(2));
    expect(markers.map((marker) => marker.itemCount), containsAll(<int>[2, 1]));

    markers.first.onTap();
    expect(nextZoom, 10.2);
  });

  testWidgets('does not render a duplicate administrative name on a cluster', (
    tester,
  ) async {
    final index = MapAdministrativeIndex.fromJson(<String, dynamic>{
      'features': <Map<String, dynamic>>[
        _label('甲市', 'city', 121.5, 25.0),
        _label('甲區', 'district', 121.5, 25.0, parent: '甲市'),
      ],
    });
    final markers = MapLayers.buildMarkers(
      features: <StaticFeature>[_feature('facility-1', 121.5, 25.0)],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 6.5,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(width: 120, height: 80, child: markers.single.child),
      ),
    );

    expect(find.text('甲市'), findsNothing);
  });

  testWidgets('uses the facility address when the nearest district is wrong', (
    tester,
  ) async {
    final index = MapAdministrativeIndex.fromJson(<String, dynamic>{
      'features': <Map<String, dynamic>>[
        _label('臺北市', 'city', 121.548858, 25.05795),
        _label('中山區', 'district', 121.538309, 25.069849, parent: '臺北市'),
        _label('內湖區', 'district', 121.592395, 25.083781, parent: '臺北市'),
      ],
    });
    final markers = MapLayers.buildMarkers(
      features: <StaticFeature>[
        _feature(
          'shelter-address-hint',
          121.5601,
          25.0858,
          address: '內湖區文湖街15號',
        ),
      ],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 10.2,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(width: 120, height: 80, child: markers.single.child),
      ),
    );

    expect(find.text('內湖區'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('內湖區')), findsOneWidget);
  });

  testWidgets('district cluster count appears from forty-five percent', (
    tester,
  ) async {
    final index = MapAdministrativeIndex.fromJson(<String, dynamic>{
      'features': <Map<String, dynamic>>[
        _label('臺北市', 'city', 121.548858, 25.05795),
        _label('內湖區', 'district', 121.592395, 25.083781, parent: '臺北市'),
      ],
    });

    MapMarkerData buildMarker(int percentage) =>
        MapLayers.buildMarkers(
          features: <StaticFeature>[
            _feature(
              'district-threshold',
              121.5601,
              25.0858,
              address: '內湖區文湖街15號',
            ),
          ],
          events: const <MeshEvent>[],
          showShelters: true,
          showMedical: false,
          showEvents: false,
          onStaticFeatureSelected: (_) {},
          onEventSelected: (_) {},
          onClusterSelected: (_, {targetZoom}) {},
          administrativeIndex: index,
          revealAllAtZoom: 15.2,
          zoom: 10.2,
          zoomPercentage: percentage,
        ).single;

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(width: 80, height: 80, child: buildMarker(26).child),
      ),
    );
    expect(find.text('1'), findsNothing);

    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(width: 80, height: 80, child: buildMarker(45).child),
      ),
    );
    expect(find.text('1'), findsOneWidget);
  });

  test('reveals original dots before facility icons', () {
    final index = MapAdministrativeIndex.fromJson(<String, dynamic>{
      'features': <Map<String, dynamic>>[
        _label('甲市', 'city', 121.5, 25.0),
        _label('甲區', 'district', 121.5, 25.0, parent: '甲市'),
        _label('甲里', 'village', 121.5, 25.0),
      ],
    });

    final dots = MapLayers.buildMarkers(
      features: <StaticFeature>[
        _feature('facility-1', 121.5, 25.0),
        _feature('facility-2', 121.51, 25.0),
      ],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 11.6,
    );

    expect(dots, hasLength(2));
    expect(
      dots.every((marker) => marker.kind == MapMarkerKind.facility),
      isTrue,
    );
    expect(dots.every((marker) => marker.width == 18), isTrue);

    final icons = MapLayers.buildMarkers(
      features: <StaticFeature>[
        _feature('facility-1', 121.5, 25.0),
        _feature('facility-2', 121.51, 25.0),
      ],
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: false,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 12.3,
    );

    expect(icons, hasLength(2));
    expect(
      icons.every((marker) => marker.kind == MapMarkerKind.facility),
      isTrue,
    );
    expect(icons.every((marker) => marker.width == 28), isTrue);
  });

  test('keeps the bundled Neihu facilities in the Neihu district bucket', () {
    final featuresJson = jsonDecode(
      File('assets/data/neihu/static-features.json').readAsStringSync(),
    );
    final labelsJson = jsonDecode(
      File(
        'assets/map/labels/taiwan-reference-labels.geojson',
      ).readAsStringSync(),
    );
    final features =
        StaticFeatureCollection.fromJson(
          Map<String, dynamic>.from(featuresJson as Map),
        ).features;
    final index = MapAdministrativeIndex.fromJson(
      Map<String, dynamic>.from(labelsJson as Map),
    );

    final markers = MapLayers.buildMarkers(
      features: features,
      events: const <MeshEvent>[],
      showShelters: true,
      showMedical: true,
      showEvents: false,
      onStaticFeatureSelected: (_) {},
      onEventSelected: (_) {},
      onClusterSelected: (_, {targetZoom}) {},
      administrativeIndex: index,
      revealAllAtZoom: 15.2,
      zoom: 10.2,
    );

    expect(markers, hasLength(1));
    expect(markers.single.itemCount, 30);
  });
}

Map<String, dynamic> _label(
  String name,
  String labelType,
  double longitude,
  double latitude, {
  String? parent,
}) => <String, dynamic>{
  'type': 'Feature',
  'properties': <String, dynamic>{
    'name': name,
    'label_type': labelType,
    if (parent != null) 'parent': parent,
  },
  'geometry': <String, dynamic>{
    'type': 'Point',
    'coordinates': <double>[longitude, latitude],
  },
};

StaticFeature _feature(
  String id,
  double longitude,
  double latitude, {
  String? address,
}) => StaticFeature(
  id: id,
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: longitude, latitude: latitude)),
  fields: <String, dynamic>{if (address != null) 'address': address},
  properties: null,
);

const _shelter = StaticFeature(
  id: 'shelter-1',
  kind: 'shelter',
  geometry: PointGeometry(GeoPoint(longitude: 121.59, latitude: 25.08)),
  fields: <String, dynamic>{'name': '潭美國小'},
  properties: null,
);

const _medical = StaticFeature(
  id: 'medical-1',
  kind: 'medical',
  geometry: PointGeometry(GeoPoint(longitude: 121.61, latitude: 25.09)),
  fields: <String, dynamic>{'name': '測試醫院'},
  properties: null,
);

const _nearbyMedical = StaticFeature(
  id: 'medical-nearby',
  kind: 'medical',
  geometry: PointGeometry(GeoPoint(longitude: 121.5901, latitude: 25.0801)),
  fields: <String, dynamic>{'name': '附近醫院'},
  properties: null,
);
