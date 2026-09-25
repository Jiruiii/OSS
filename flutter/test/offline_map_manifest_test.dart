import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/offline_map_manifest.dart';

void main() {
  test('catalogue defines Taiwan overview and four street packages', () {
    expect(
      OfflineMapPackageCatalog.all.map((package) => package.id),
      <String>[
        'taiwan',
        'taiwan-north',
        'taiwan-central',
        'taiwan-south',
        'taiwan-east',
      ],
    );

    final overview = OfflineMapPackageCatalog.byId('taiwan');
    expect(overview.assetPath, 'assets/map/pmtiles/taiwan.pmtiles');
    expect(overview.minZoom, 0);
    expect(overview.maxZoom, 12);
    expect(overview.bounds.contains(longitude: 121.565, latitude: 25.035),
        isTrue);

    for (final package in OfflineMapPackageCatalog.regions) {
      expect(package.assetPath, startsWith('assets/map/pmtiles/'));
      expect(package.minZoom, 13);
      expect(package.maxZoom, 15);
      expect(package.sourceDate, isNotEmpty);
      expect(package.sha256, hasLength(64));
    }
  });

  test('manifest JSON round-trips without losing package metadata', () {
    const package = OfflineMapPackageManifest(
      id: 'taiwan-test',
      assetPath: 'assets/map/pmtiles/taiwan-test.pmtiles',
      fileName: 'taiwan-test.pmtiles',
      minZoom: 0,
      maxZoom: 12,
      minLongitude: 119.9,
      minLatitude: 21.8,
      maxLongitude: 122.2,
      maxLatitude: 25.5,
      sourceDate: '2026-09-20',
      sha256:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );

    final decoded = OfflineMapPackageManifest.fromJson(
      jsonDecode(jsonEncode(package.toJson())) as Map<String, dynamic>,
    );

    expect(decoded.id, package.id);
    expect(decoded.assetPath, package.assetPath);
    expect(decoded.bounds, package.bounds);
    expect(decoded.minZoom, package.minZoom);
    expect(decoded.maxZoom, package.maxZoom);
    expect(decoded.sourceDate, package.sourceDate);
    expect(decoded.sha256, package.sha256);
  });
}
