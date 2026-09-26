import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_marker_projection.dart';

void main() {
  test('coalesces camera projections to the latest value in one frame', () {
    final gate = MapCameraProjectionFrameGate<int>();
    final scheduled = <void Function()>[];
    final applied = <int>[];

    void scheduleFrame(void Function() callback) => scheduled.add(callback);

    gate.enqueue(1, scheduleFrame, applied.add);
    gate.enqueue(2, scheduleFrame, applied.add);

    expect(scheduled, hasLength(1));
    expect(applied, isEmpty);

    scheduled.single();

    expect(applied, <int>[2]);
  });

  test('a newer camera projection invalidates older async results', () {
    final gate = MapMarkerProjectionGate();

    final firstRequest = gate.request();
    final latestRequest = gate.request();

    expect(gate.isCurrent(firstRequest), isFalse);
    expect(gate.isCurrent(latestRequest), isTrue);
  });

  test('caches marker layout until it is invalidated', () {
    final cache = MapMarkerLayoutCache<List<int>>();
    var buildCount = 0;

    final first = cache.getOrBuild(() {
      buildCount += 1;
      return <int>[buildCount];
    });
    final second = cache.getOrBuild(() {
      buildCount += 1;
      return <int>[buildCount];
    });

    expect(buildCount, 1);
    expect(identical(first, second), isTrue);

    cache.invalidate();
    final third = cache.getOrBuild(() {
      buildCount += 1;
      return <int>[buildCount];
    });

    expect(buildCount, 2);
    expect(third, <int>[2]);
  });
}
