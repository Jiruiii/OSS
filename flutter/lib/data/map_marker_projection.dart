/// Guards asynchronous screen-coordinate conversions made through the
/// MapLibre platform channel. A camera move can finish after a newer move;
/// stale results must never overwrite the latest marker positions.
class MapMarkerProjectionGate {
  int _latestRequest = 0;

  int request() => ++_latestRequest;

  bool isCurrent(int request) => request == _latestRequest;
}
