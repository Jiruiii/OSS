import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final mode in <String>['light', 'dark']) {
    test(
      'Taiwan $mode style uses local PMTiles and Traditional Chinese',
      () async {
        final raw = await rootBundle.loadString(
          'assets/map/styles/taiwan-$mode.json',
        );
        final style = jsonDecode(raw) as Map<String, dynamic>;
        final sources = style['sources'] as Map<String, dynamic>;
        final layers = style['layers'] as List<dynamic>;

        expect(style['version'], 8);
        expect(style['metadata'], containsPair('map:locale', 'zh-Hant'));
        expect(style['glyphs'], startsWith('asset://'));
        expect(style['sprite'], startsWith('asset://'));
        expect(
          sources.keys,
          containsAll(<String>[
            'taiwan-overview',
            'taiwan-north',
            'taiwan-central',
            'taiwan-south',
            'taiwan-east',
          ]),
        );

        for (final source in sources.values) {
          final sourceJson = source as Map<String, dynamic>;
          expect(sourceJson['type'], 'vector');
          expect(sourceJson['url'], startsWith('pmtiles://asset://'));
          expect(sourceJson['attribution'], contains('OpenStreetMap'));
        }

        expect(
          layers.whereType<Map<String, dynamic>>().map((layer) => layer['id']),
          containsAll(<String>[
            'taiwan-background',
            'taiwan-water',
            'taiwan-landuse',
            'taiwan-buildings',
            'taiwan-roads',
            'taiwan-places',
            'taiwan-pois',
            'taiwan-north-roads',
            'taiwan-central-roads',
            'taiwan-south-roads',
            'taiwan-east-roads',
          ]),
        );

        for (final layer in layers.whereType<Map<String, dynamic>>().where(
          (layer) => layer['type'] == 'symbol',
        )) {
          expect(
            (layer['layout'] as Map<String, dynamic>)['text-font'],
            <String>['Noto Sans Regular'],
          );
        }

        final placeLayers = layers
            .whereType<Map<String, dynamic>>()
            .where((layer) => layer['source-layer'] == 'places')
            .toList(growable: false);
        expect(placeLayers, isNotEmpty);
      for (final layer in placeLayers) {
        expect(layer['maxzoom'], isNotNull);
        expect(jsonEncode(layer['filter']), contains('"match"'));
        final layout = layer['layout'] as Map<String, dynamic>;
          expect(layout['text-allow-overlap'], isFalse);
          expect(layout['text-ignore-placement'], isFalse);
        }

        final poiLayers = layers
            .whereType<Map<String, dynamic>>()
            .where((layer) => layer['source-layer'] == 'pois')
            .toList(growable: false);
        expect(poiLayers, isNotEmpty);
      for (final layer in poiLayers) {
        expect(layer['minzoom'], greaterThanOrEqualTo(15));
        expect(layer['filter'], isA<List<dynamic>>());
        expect((layer['filter'] as List<dynamic>).first, 'match');
          final layout = layer['layout'] as Map<String, dynamic>;
          expect(layout['text-allow-overlap'], isFalse);
          expect(layout['text-ignore-placement'], isFalse);
        }

        final serialized = jsonEncode(style);
        expect(serialized, isNot(contains('https://')));
        expect(serialized, isNot(contains('http://')));
      },
    );
  }
}
