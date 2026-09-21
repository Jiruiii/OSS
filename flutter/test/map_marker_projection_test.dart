import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_marker_projection.dart';

void main() {
  test('a newer camera projection invalidates older async results', () {
    final gate = MapMarkerProjectionGate();

    final firstRequest = gate.request();
    final latestRequest = gate.request();

    expect(gate.isCurrent(firstRequest), isFalse);
    expect(gate.isCurrent(latestRequest), isTrue);
  });
}
