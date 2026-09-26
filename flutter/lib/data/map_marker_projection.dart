/// Coalesces camera projection work so a burst of native camera callbacks is
/// applied at most once per Flutter frame, using the latest camera position.
class MapCameraProjectionFrameGate<T> {
  T? _pending;
  bool _frameScheduled = false;

  void enqueue(
    T value,
    void Function(void Function()) scheduleFrame,
    void Function(T) apply,
  ) {
    _pending = value;
    if (_frameScheduled) return;
    _frameScheduled = true;
    scheduleFrame(() {
      _frameScheduled = false;
      final latest = _pending;
      _pending = null;
      if (latest != null) apply(latest);
    });
  }
}

/// Caches the expensive marker layout separately from its screen projection.
///
/// Panning changes marker positions but not the data grouping/layout. Callers
/// invalidate this cache when data, filters, or a settled zoom level changes.
class MapMarkerLayoutCache<T> {
  T? _value;
  bool _hasValue = false;
  bool _dirty = true;

  T getOrBuild(T Function() builder) {
    if (_hasValue && !_dirty) return _value!;
    final value = builder();
    _value = value;
    _hasValue = true;
    _dirty = false;
    return value;
  }

  void invalidate() {
    _dirty = true;
  }

  void clear() {
    _value = null;
    _hasValue = false;
    _dirty = true;
  }
}

/// Guards asynchronous screen-coordinate conversions made through the
/// MapLibre platform channel. A camera move can finish after a newer move;
/// stale results must never overwrite the latest marker positions.
class MapMarkerProjectionGate {
  int _latestRequest = 0;

  int request() => ++_latestRequest;

  bool isCurrent(int request) => request == _latestRequest;
}
