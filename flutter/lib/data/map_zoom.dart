/// Converts provider-specific numeric zoom levels to the percentage shown in
/// the shared map controls.
abstract final class ZoomPercentage {
  static int fromZoom({
    required double zoom,
    required double minZoom,
    required double maxZoom,
    double? overviewZoom,
    double overviewSnapTolerance = 0.02,
  }) {
    final zeroZoom = _zeroZoom(
      minZoom: minZoom,
      maxZoom: maxZoom,
      overviewZoom: overviewZoom,
    );
    if (maxZoom <= zeroZoom) return 0;

    final clampedZoom = zoom.clamp(zeroZoom, maxZoom).toDouble();
    if (overviewZoom != null &&
        clampedZoom <= zeroZoom + overviewSnapTolerance) {
      return 0;
    }
    final percentage = ((clampedZoom - zeroZoom) / (maxZoom - zeroZoom)) * 100;
    return (percentage + 1e-9).round();
  }

  static double toZoom({
    required int percentage,
    required double minZoom,
    required double maxZoom,
    double? overviewZoom,
  }) {
    final zeroZoom = _zeroZoom(
      minZoom: minZoom,
      maxZoom: maxZoom,
      overviewZoom: overviewZoom,
    );
    if (maxZoom <= zeroZoom) return zeroZoom;

    final clampedPercentage = percentage.clamp(0, 100);
    return zeroZoom +
        (maxZoom - zeroZoom) * (clampedPercentage.toDouble() / 100);
  }

  static double _zeroZoom({
    required double minZoom,
    required double maxZoom,
    required double? overviewZoom,
  }) => (overviewZoom ?? minZoom).clamp(minZoom, maxZoom).toDouble();
}

/// Keeps only the latest pending camera request relevant to the map controls.
class MapZoomRequestGate {
  int _latestRequest = 0;

  int request() => ++_latestRequest;

  bool isCurrent(int request) => request == _latestRequest;
}
