/// Converts provider-specific numeric zoom levels to the percentage shown in
/// the shared map controls.
abstract final class ZoomPercentage {
  static int fromZoom({
    required double zoom,
    required double minZoom,
    required double maxZoom,
  }) {
    if (maxZoom <= minZoom) return 0;

    final clampedZoom = zoom.clamp(minZoom, maxZoom).toDouble();
    final percentage = ((clampedZoom - minZoom) / (maxZoom - minZoom)) * 100;
    return (percentage + 1e-9).round();
  }

  static double toZoom({
    required int percentage,
    required double minZoom,
    required double maxZoom,
  }) {
    if (maxZoom <= minZoom) return minZoom;

    final clampedPercentage = percentage.clamp(0, 100);
    return minZoom + (maxZoom - minZoom) * (clampedPercentage.toDouble() / 100);
  }
}
