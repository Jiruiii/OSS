import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import 'evacuation_models.dart';
import 'map_bridge.dart';
import 'map_models.dart';
import 'map_search.dart';

/// Bounded, opt-in diagnostics in debug/profile builds; no release overhead.
class AppPerformance {
  static Future<MapSearchQuery> Function(String)? search;
  static void register() {
    if (kReleaseMode) return;
    developer.registerExtension('ext.resilientgeo.search', (
      _,
      parameters,
    ) async {
      final query = search;
      if (query == null) {
        return developer.ServiceExtensionResponse.result('{"ready":false}');
      }
      final watch = Stopwatch()..start();
      final result = await query(parameters['query'] ?? '');
      return developer.ServiceExtensionResponse.result(
        jsonEncode({
          'ready': true,
          'elapsed_ms': watch.elapsedMicroseconds / 1000,
          'results': result.results.length,
        }),
      );
    });
    developer.registerExtension('ext.resilientgeo.routeBenchmark', (
      _,
      parameters,
    ) async {
      final watch = Stopwatch()..start();
      final result = await MapBridge().calculateEvacuationRoute(
        origin: GeoPoint(
          longitude: double.parse(parameters['lon']!),
          latitude: double.parse(parameters['lat']!),
        ),
        destination: ShelterRouteCandidate(
          id: 'benchmark',
          location: GeoPoint(
            longitude: double.parse(parameters['targetLon']!),
            latitude: double.parse(parameters['targetLat']!),
          ),
        ),
      );
      return developer.ServiceExtensionResponse.result(
        jsonEncode({
          'elapsed_ms': watch.elapsedMicroseconds / 1000,
          'status': result.status.wireValue,
          'distance_m': result.distanceM,
          'points': result.polyline.length,
        }),
      );
    });
    final frames = <FrameTiming>[];
    SchedulerBinding.instance.addTimingsCallback((batch) {
      frames.addAll(batch);
      if (frames.length > 600) frames.removeRange(0, frames.length - 600);
    });
    developer.registerExtension('ext.resilientgeo.performance', (
      _,
      parameters,
    ) async {
      if (parameters['reset'] == 'true') frames.clear();
      double percentile(List<int> values, double p) {
        if (values.isEmpty) return 0;
        values.sort();
        return values[((values.length - 1) * p).round()] / 1000;
      }

      return developer.ServiceExtensionResponse.result(
        jsonEncode({
          'frames': frames.length,
          'build_p50_ms': percentile(
            frames.map((f) => f.buildDuration.inMicroseconds).toList(),
            .5,
          ),
          'build_p95_ms': percentile(
            frames.map((f) => f.buildDuration.inMicroseconds).toList(),
            .95,
          ),
          'raster_p95_ms': percentile(
            frames.map((f) => f.rasterDuration.inMicroseconds).toList(),
            .95,
          ),
          'total_p95_ms': percentile(
            frames.map((f) => f.totalSpan.inMicroseconds).toList(),
            .95,
          ),
          'slow_frames':
              frames
                  .where(
                    (f) =>
                        f.buildDuration.inMilliseconds > 16 ||
                        f.rasterDuration.inMilliseconds > 16,
                  )
                  .length,
        }),
      );
    });
  }
}
