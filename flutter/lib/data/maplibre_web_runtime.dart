import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

abstract final class MapLibreWebRuntime {
  static const version = '6.4.1';
  static const scriptPath = 'maplibre/6.4.1/dist/maplibre-gl.mjs';
  static const stylePath = 'maplibre/6.4.1/dist/maplibre-gl.css';

  static MapLibreJsSource source({required Uri baseUri}) =>
      MapLibreJsSource.urls(
        scriptUrl: baseUri.resolve(scriptPath).toString(),
        styleUrl: baseUri.resolve(stylePath).toString(),
      );

  static void configure({Uri? baseUri}) {
    if (!kIsWeb) return;
    MapLibreMap.webLibrarySource = source(baseUri: baseUri ?? Uri.base);
  }
}
