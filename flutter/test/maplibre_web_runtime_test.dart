import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'package:resilientgeo_flutter/data/maplibre_web_runtime.dart';

void main() {
  test('uses the pinned local MapLibre GL JS runtime', () {
    final source = MapLibreWebRuntime.source(
      baseUri: Uri.parse('http://localhost:8787/'),
    );

    expect(MapLibreWebRuntime.version, '6.4.1');
    expect(
      source.scriptUrl,
      'http://localhost:8787/maplibre/6.4.1/dist/maplibre-gl.mjs',
    );
    expect(
      source.styleUrl,
      'http://localhost:8787/maplibre/6.4.1/dist/maplibre-gl.css',
    );
    expect(source.scriptUrl, isNot(contains('unpkg.com')));
    expect(source.styleUrl, isNot(contains('unpkg.com')));
  });

  test('returns the public CDN-free source type', () {
    final source = MapLibreWebRuntime.source(
      baseUri: Uri.parse('http://localhost:8787/'),
    );

    expect(source, isA<MapLibreJsSource>());
    expect(source.preloaded, isFalse);
  });
}
