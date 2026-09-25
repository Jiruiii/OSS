import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('self-hosted MapLibre runtime files are present', () {
    final requiredFiles = <String>[
      'web/maplibre/6.4.1/dist/maplibre-gl.mjs',
      'web/maplibre/6.4.1/dist/maplibre-gl.css',
      'web/maplibre/6.4.1/LICENSE',
      'web/maplibre/6.4.1/metadata.json',
      'web/fonts/roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2',
      'web/fonts/roboto/v32/metadata.json',
    ];

    for (final path in requiredFiles) {
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: path);
      expect(file.lengthSync(), greaterThan(0), reason: path);
    }
  });
}
