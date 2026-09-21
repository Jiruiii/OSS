import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_zoom.dart';

void main() {
  group('ZoomPercentage.fromZoom', () {
    test('maps provider boundaries to 0 and 100 percent', () {
      expect(ZoomPercentage.fromZoom(zoom: 0, minZoom: 0, maxZoom: 15), 0);
      expect(ZoomPercentage.fromZoom(zoom: 15, minZoom: 0, maxZoom: 15), 100);
    });

    test('rounds midpoint values to the nearest integer', () {
      expect(
        ZoomPercentage.fromZoom(zoom: 14.75, minZoom: 12, maxZoom: 17),
        55,
      );
      expect(
        ZoomPercentage.fromZoom(zoom: 14.725, minZoom: 12, maxZoom: 17),
        55,
      );
    });

    test('clamps zoom outside both provider ranges', () {
      expect(ZoomPercentage.fromZoom(zoom: 8, minZoom: 12, maxZoom: 20), 0);
      expect(ZoomPercentage.fromZoom(zoom: 99, minZoom: 12, maxZoom: 17), 100);
    });

    test('returns zero safely when the range has no span', () {
      expect(ZoomPercentage.fromZoom(zoom: 17, minZoom: 17, maxZoom: 17), 0);
    });
  });

  group('ZoomPercentage.toZoom', () {
    test('maps 0, 50, and 100 percent across MapLibre zoom range', () {
      expect(
        ZoomPercentage.toZoom(percentage: 0, minZoom: 0, maxZoom: 15),
        0,
      );
      expect(
        ZoomPercentage.toZoom(percentage: 50, minZoom: 0, maxZoom: 15),
        7.5,
      );
      expect(
        ZoomPercentage.toZoom(percentage: 100, minZoom: 0, maxZoom: 15),
        15,
      );
    });

    test('maps percentages across the offline tile range', () {
      expect(
        ZoomPercentage.toZoom(percentage: 50, minZoom: 0, maxZoom: 15),
        7.5,
      );
    });

    test('clamps percentages outside 0 through 100', () {
      expect(
        ZoomPercentage.toZoom(percentage: -10, minZoom: 0, maxZoom: 15),
        0,
      );
      expect(
        ZoomPercentage.toZoom(percentage: 150, minZoom: 0, maxZoom: 15),
        15,
      );
    });

    test('returns the provider zoom safely when the range has no span', () {
      expect(
        ZoomPercentage.toZoom(percentage: 75, minZoom: 17, maxZoom: 17),
        17,
      );
    });
  });
}
