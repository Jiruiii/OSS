import 'dart:async';
import 'dart:js_interop';

import 'package:maplibre_gl/maplibre_gl.dart';

@JS('registerProtomapsProtocol')
external JSBoolean? _registerProtomapsProtocol();

Future<void> registerWebPmtilesProtocol() async {
  await MapLibreMap.ensureWebLibraryLoaded();
  final deadline = DateTime.now().add(const Duration(seconds: 10));
  while (DateTime.now().isBefore(deadline)) {
    final registered = _registerProtomapsProtocol()?.toDart ?? false;
    if (registered) return;
    await Future<void>.delayed(const Duration(milliseconds: 16));
  }
  throw StateError(
    'PMTiles protocol bridge is unavailable. Ensure web/pmtiles.js and '
    'web/pmtiles_protocol.js are served before Flutter bootstrap.',
  );
}
