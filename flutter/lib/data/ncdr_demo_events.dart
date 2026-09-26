import 'dart:convert';

import 'package:flutter/services.dart';

import 'map_models.dart';

typedef DemoAssetLoader = Future<String> Function(String assetPath);

/// Loads the latest real NCDR collection exported for the Flutter preview.
///
/// This is deliberately an asset loader, not an API client. The NCDR API key
/// remains in the pipeline environment, and the Android host can later replace
/// this source with its verified Room/EventChannel stream without changing the
/// map event model.
class NcdrDemoEventLoader {
  const NcdrDemoEventLoader({DemoAssetLoader? loadAsset})
    : _loadAsset = loadAsset ?? _loadRootBundleAsset;

  static const assetPath = 'assets/data/taiwan/ncdr-hazard-events.json';

  final DemoAssetLoader _loadAsset;

  Future<List<MeshEvent>> load() async {
    final decoded = jsonDecode(await _loadAsset(assetPath));
    if (decoded is! Map) {
      throw const FormatException('NCDR demo asset root must be an object');
    }

    final root = Map<String, dynamic>.from(decoded);
    if (root['source_id'] != 'ncdr-hazard-events') {
      throw const FormatException(
        'NCDR demo asset has an unexpected source_id',
      );
    }

    final events = eventsFromMessage(root['events']);
    final declaredCount = root['event_count'];
    if (declaredCount is int && declaredCount != events.length) {
      throw FormatException(
        'NCDR demo asset event_count $declaredCount does not match ${events.length}',
      );
    }
    return List<MeshEvent>.unmodifiable(events);
  }
}

Future<String> _loadRootBundleAsset(String assetPath) =>
    rootBundle.loadString(assetPath);
