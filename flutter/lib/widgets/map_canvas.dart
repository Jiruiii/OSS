import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../data/map_models.dart';
import '../data/map_runtime_state.dart';
import '../data/map_search.dart';
import '../data/map_marker_projection.dart';
import '../data/map_zoom.dart';
import '../data/maplibre_map_config.dart';
import '../data/maplibre_overlay.dart';
import '../data/offline_map_asset_store.dart';
import '../data/flutter_test_environment.dart';
import 'map_layers.dart';
import 'map_zoom_controls.dart';

/// The single MapLibre renderer used by the app. Remote and raster tile
/// providers are intentionally absent from this widget.
class MapCanvas extends StatefulWidget {
  const MapCanvas({
    super.key,
    required this.runtimeState,
    required this.staticFeatures,
    required this.visibleEvents,
    required this.showShelters,
    required this.showMedical,
    required this.showEvents,
    required this.onStaticFeatureSelected,
    required this.onEventSelected,
    required this.onZoomPercentageChanged,
    required this.onOpenLayerSettings,
    required this.onRequestLocation,
    required this.onMapTap,
    this.onSearchFocus,
    this.onRecenter,
    this.searchSelection,
    this.focusPoint,
    this.focusRequestId = 0,
  });

  static const double minZoom = MapLibreMapConfig.minZoom;
  static const double maxZoom = MapLibreMapConfig.maxZoom;
  static const GeoPoint taiwanOverviewCenter =
      MapLibreMapConfig.taiwanOverviewCenter;

  final MapRuntimeState runtimeState;
  final List<StaticFeature> staticFeatures;
  final List<MeshEvent> visibleEvents;
  final bool showShelters;
  final bool showMedical;
  final bool showEvents;
  final StaticFeatureSelection onStaticFeatureSelected;
  final MeshEventSelection onEventSelected;
  final ValueChanged<int> onZoomPercentageChanged;
  final VoidCallback onOpenLayerSettings;
  final VoidCallback onRequestLocation;
  final VoidCallback onMapTap;
  final VoidCallback? onSearchFocus;
  final VoidCallback? onRecenter;
  final MapSearchResult? searchSelection;
  final GeoPoint? focusPoint;
  final int focusRequestId;

  @override
  State<MapCanvas> createState() => _MapCanvasState();
}

class _MapCanvasState extends State<MapCanvas> with TickerProviderStateMixin {
  static const _focusAnimationDuration = Duration(milliseconds: 650);
  static const _eventsSourceId = 'app-events';
  static const _eventsLineLayerId = 'app-events-lines';
  static const _eventsFillLayerId = 'app-events-polygons';
  static final _taiwanBounds = LatLngBounds(
    southwest: const LatLng(21.8, 119.9),
    northeast: const LatLng(25.5, 122.2),
  );

  final OfflineMapAssetStore _assetStore = OfflineMapAssetStore();
  final ValueNotifier<Offset?> _radarScreenPosition = ValueNotifier(null);
  late final AnimationController _pulseController;
  MapLibreMapController? _mapController;
  String? _styleJson;
  Object? _styleError;
  bool _styleLoaded = false;
  bool _eventSourceReady = false;
  bool _markerRefreshScheduled = false;
  bool _markerProjectionInFlight = false;
  final MapMarkerProjectionGate _markerProjectionGate =
      MapMarkerProjectionGate();
  bool _initialOverviewApplied = false;
  int _lastFocusRequestId = -1;
  Timer? _pulseStartTimer;
  Timer? _pulseStopTimer;
  GeoPoint? _pendingEventFocus;
  GeoPoint? _radarEventPoint;
  bool _pendingEventAnimated = true;
  bool _radarVisible = false;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadStyle();
  }

  @override
  void didUpdateWidget(covariant MapCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.runtimeState.themeMode != widget.runtimeState.themeMode) {
      _loadStyle();
    }
    if (oldWidget.visibleEvents != widget.visibleEvents ||
        oldWidget.showEvents != widget.showEvents) {
      unawaited(_updateEventSource());
      _queueMarkerRefresh();
    }
    if (oldWidget.staticFeatures != widget.staticFeatures ||
        oldWidget.showShelters != widget.showShelters ||
        oldWidget.showMedical != widget.showMedical ||
        oldWidget.runtimeState.currentLocation !=
            widget.runtimeState.currentLocation) {
      _queueMarkerRefresh();
    }
    final focusingNewEvent = _recordNewEvents(oldWidget.visibleEvents);
    final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
    if (!focusingNewEvent &&
        focus != null &&
        widget.focusRequestId != _lastFocusRequestId) {
      _lastFocusRequestId = widget.focusRequestId;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_focus(focus, animated: _animationsAllowed));
      });
    }
    if (oldWidget.runtimeState.currentLocation !=
            widget.runtimeState.currentLocation &&
        widget.runtimeState.currentLocation != null &&
        widget.focusRequestId == _lastFocusRequestId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _queueMarkerRefresh();
      });
    }
  }

  @override
  void dispose() {
    _pulseStartTimer?.cancel();
    _pulseStopTimer?.cancel();
    _pulseController.dispose();
    _radarScreenPosition.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  bool get _animationsAllowed =>
      widget.runtimeState.animationEnabled &&
      !(MediaQuery.maybeOf(context)?.disableAnimations ?? false);

  bool get _usesPlatformMap =>
      !isFlutterTest &&
      (kIsWeb ||
          defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  Future<void> _loadStyle() async {
    final styleAsset = MapLibreMapConfig.styleAssetFor(
      themeMode: widget.runtimeState.themeMode,
      systemBrightness: Theme.of(context).brightness,
    );
    try {
      final style = await _assetStore.loadStyle(
        styleAsset: styleAsset,
        installNativeAssets: _usesPlatformMap && !kIsWeb,
      );
      if (!mounted) return;
      setState(() {
        _styleJson = style;
        _styleError = null;
        _styleLoaded = false;
        _eventSourceReady = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _styleError = error);
    }
  }

  bool _recordNewEvents(List<MeshEvent> oldEvents) {
    final oldKeys = oldEvents.map(eventKey).toSet();
    final newEvents = widget.visibleEvents
        .where((event) => !oldKeys.contains(eventKey(event)))
        .toList(growable: false);
    if (newEvents.isEmpty) return false;
    final focus = meshEventFocusPoint(newEvents.last);
    if (focus == null) return false;
    _pendingEventFocus = focus;
    _pendingEventAnimated = _animationsAllowed;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_focusPendingEvent());
    });
    return true;
  }

  Future<void> _focusPendingEvent() async {
    final focus = _pendingEventFocus;
    if (focus == null ||
        !await _focus(focus, animated: _pendingEventAnimated)) {
      return;
    }
    _pendingEventFocus = null;
    if (!_pendingEventAnimated) {
      _stopRadar();
      return;
    }
    _pulseStartTimer?.cancel();
    _pulseStopTimer?.cancel();
    _pulseStartTimer = Timer(_focusAnimationDuration, () {
      if (mounted) unawaited(_showRadarAndStop(focus));
    });
  }

  Future<void> _showRadarAndStop(GeoPoint point) async {
    await _showRadar(point);
    if (!mounted || _radarEventPoint != point) return;
    _pulseStopTimer = Timer(const Duration(milliseconds: 3600), () {
      if (mounted) _stopRadar();
    });
  }

  Future<void> _showRadar(GeoPoint point) async {
    _radarEventPoint = point;
    final hasPosition = await _updateRadarScreenPosition(point);
    if (!mounted || _radarEventPoint != point || !hasPosition) return;
    setState(() => _radarVisible = true);
    _pulseController
      ..reset()
      ..repeat();
  }

  void _stopRadar() {
    _pulseStartTimer?.cancel();
    _pulseStartTimer = null;
    _pulseStopTimer?.cancel();
    _pulseStopTimer = null;
    _pulseController.stop();
    _radarEventPoint = null;
    _radarScreenPosition.value = null;
    if (mounted && _radarVisible) setState(() => _radarVisible = false);
  }

  Future<void> _setZoomPercentage(int percentage) async {
    final clamped = percentage.clamp(0, 100);
    final zoom = ZoomPercentage.toZoom(
      percentage: clamped,
      minZoom: MapCanvas.minZoom,
      maxZoom: MapCanvas.maxZoom,
    );
    widget.onZoomPercentageChanged(clamped);
    final controller = _mapController;
    if (controller == null) return;
    await controller.animateCamera(
      CameraUpdate.zoomTo(zoom),
      duration: _focusAnimationDuration,
    );
  }

  Future<void> _recenter() async {
    widget.onRecenter?.call();
    _pendingEventFocus = null;
    _stopRadar();
    final controller = _mapController;
    if (controller == null) return;
    await _moveToTaiwanOverview(animated: _animationsAllowed);
  }

  Future<void> _moveToTaiwanOverview({required bool animated}) async {
    final controller = _mapController;
    if (controller == null) return;
    final update = CameraUpdate.newLatLngBounds(
      _taiwanBounds,
      left: 24,
      top: 24,
      right: 24,
      bottom: 120,
    );
    if (animated) {
      await controller.animateCamera(update, duration: _focusAnimationDuration);
    } else {
      await controller.moveCamera(update);
    }
  }

  Future<bool> _focus(GeoPoint point, {required bool animated}) async {
    final controller = _mapController;
    if (controller == null || !_styleLoaded) return false;
    const focusPercentage = 70;
    final zoom = ZoomPercentage.toZoom(
      percentage: focusPercentage,
      minZoom: MapCanvas.minZoom,
      maxZoom: MapCanvas.maxZoom,
    );
    widget.onZoomPercentageChanged(focusPercentage);
    final update = CameraUpdate.newLatLngZoom(_latLng(point), zoom);
    if (animated) {
      await controller.animateCamera(update, duration: _focusAnimationDuration);
    } else {
      await controller.moveCamera(update);
    }
    return true;
  }

  void _onCameraMove(CameraPosition position) {
    final percentage = ZoomPercentage.fromZoom(
      zoom: position.zoom,
      minZoom: MapCanvas.minZoom,
      maxZoom: MapCanvas.maxZoom,
    );
    if (percentage != widget.runtimeState.zoomPercentage) {
      widget.onZoomPercentageChanged(percentage);
    }
    _queueMarkerRefresh();
  }

  void _queueMarkerRefresh() {
    final request = _markerProjectionGate.request();
    if (_markerRefreshScheduled || _markerProjectionInFlight) return;
    _markerRefreshScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _markerRefreshScheduled = false;
      if (mounted) unawaited(_refreshMarkerPositions(request));
    });
  }

  List<MapMarkerData> _markers() => MapLayers.buildMarkers(
    features: widget.staticFeatures,
    events: widget.visibleEvents,
    showShelters: widget.showShelters,
    showMedical: widget.showMedical,
    showEvents: widget.showEvents,
    onStaticFeatureSelected: widget.onStaticFeatureSelected,
    onEventSelected: widget.onEventSelected,
    currentLocation: widget.runtimeState.currentLocation,
  );

  final Map<Key, Offset> _markerPositions = <Key, Offset>{};

  Future<void> _refreshMarkerPositions(int request) async {
    if (_markerProjectionInFlight) return;
    _markerProjectionInFlight = true;
    final controller = _mapController;
    try {
      if (controller == null) return;
      final markers = _markers();
      if (markers.isEmpty) {
        if (_markerProjectionGate.isCurrent(request) &&
            _markerPositions.isNotEmpty &&
            mounted) {
          setState(_markerPositions.clear);
        }
        return;
      }
      final points = await controller.toScreenLocationBatch(
        markers.map((marker) => _latLng(marker.point)),
      );
      if (!mounted || !_markerProjectionGate.isCurrent(request)) return;
      final next = <Key, Offset>{};
      for (
        var index = 0;
        index < markers.length && index < points.length;
        index++
      ) {
        final point = points[index];
        next[markers[index].key] = Offset(
          point.x.toDouble(),
          point.y.toDouble(),
        );
      }
      setState(() {
        _markerPositions
          ..clear()
          ..addAll(next);
      });
      final radarPoint = _radarEventPoint;
      if (radarPoint != null) {
        await _updateRadarScreenPosition(radarPoint, request: request);
      }
    } on Object {
      // The native view can be between style/camera lifecycles. The next map
      // idle callback will retry without interrupting the rest of the UI.
    } finally {
      _markerProjectionInFlight = false;
      if (mounted && !_markerProjectionGate.isCurrent(request)) {
        _queueMarkerRefresh();
      }
    }
  }

  Future<void> _onStyleLoaded() async {
    _styleLoaded = true;
    await _ensureEventLayers();
    _queueMarkerRefresh();
    if (!_initialOverviewApplied &&
        widget.runtimeState.currentLocation == null &&
        widget.focusPoint == null &&
        widget.searchSelection == null) {
      _initialOverviewApplied = true;
      await _moveToTaiwanOverview(animated: false);
    }
    if (_pendingEventFocus != null) {
      await _focusPendingEvent();
      return;
    }
    final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
    if (focus != null) {
      _lastFocusRequestId = widget.focusRequestId;
      await _focus(focus, animated: _animationsAllowed);
    }
  }

  Future<void> _ensureEventLayers() async {
    final controller = _mapController;
    if (controller == null || !_styleLoaded) return;
    try {
      if (!_eventSourceReady) {
        await controller.addGeoJsonSource(
          _eventsSourceId,
          MapLibreOverlayData.eventFeatureCollection(
            widget.showEvents ? widget.visibleEvents : const <MeshEvent>[],
          ),
        );
        await controller.addFillLayer(
          _eventsSourceId,
          _eventsFillLayerId,
          const FillLayerProperties(
            fillColor: ['get', 'color'],
            fillOpacity: ['get', 'opacity'],
            fillOutlineColor: ['get', 'color'],
          ),
          enableInteraction: false,
        );
        await controller.addLineLayer(
          _eventsSourceId,
          _eventsLineLayerId,
          const LineLayerProperties(
            lineColor: ['get', 'color'],
            lineOpacity: 0.95,
            lineWidth: ['get', 'line_width'],
          ),
          enableInteraction: false,
        );
        _eventSourceReady = true;
      } else {
        await _updateEventSource();
      }
    } on Object {
      // Keep the map usable if an older native MapLibre build cannot add a
      // runtime layer. The Flutter marker overlay still remains available.
    }
  }

  Future<void> _updateEventSource() async {
    if (!_eventSourceReady || _mapController == null) return;
    try {
      await _mapController!.setGeoJsonSource(
        _eventsSourceId,
        MapLibreOverlayData.eventFeatureCollection(
          widget.showEvents ? widget.visibleEvents : const <MeshEvent>[],
        ),
      );
    } on Object {
      // A style replacement invalidates the old source; style callback will
      // rebuild it.
    }
  }

  Future<void> _onMapClick(math.Point<double> point, LatLng coordinates) async {
    final controller = _mapController;
    if (controller != null && _eventSourceReady && widget.showEvents) {
      try {
        final rendered = await controller.queryRenderedFeatures(point, <String>[
          _eventsLineLayerId,
          _eventsFillLayerId,
        ], null);
        for (final feature in rendered) {
          if (feature is! Map) continue;
          final properties = feature['properties'];
          final id = properties is Map ? properties['event_id'] : null;
          if (id is! String) continue;
          final event = widget.visibleEvents.firstWhere(
            (candidate) => meshEventIdentity(candidate) == id,
            orElse:
                () => const MeshEvent(
                  namespace: null,
                  eventId: null,
                  eventVersion: null,
                  eventType: null,
                  severity: null,
                  source: null,
                  issuedAt: null,
                  expiresAt: null,
                  applyState: null,
                  geometry: null,
                  attributes: null,
                ),
          );
          if (event.eventId != null) {
            widget.onEventSelected(event);
            return;
          }
        }
      } on Object {
        // A basemap tap remains a valid interaction on platforms without
        // rendered-feature query support.
      }
    }
    widget.onMapTap();
  }

  Future<bool> _updateRadarScreenPosition(
    GeoPoint point, {
    int? request,
  }) async {
    final controller = _mapController;
    if (controller == null || !_styleLoaded) return false;
    try {
      final screen = await controller.toScreenLocation(_latLng(point));
      if (request != null && !_markerProjectionGate.isCurrent(request)) {
        return false;
      }
      _radarScreenPosition.value = Offset(
        screen.x.toDouble(),
        screen.y.toDouble(),
      );
      return true;
    } on Object {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final baseMap =
        !_usesPlatformMap
            ? _buildPreviewSurface()
            : _styleError != null
            ? _buildErrorSurface()
            : _styleJson == null
            ? _buildLoadingSurface()
            : _buildMapLibreMap();
    final markers = _markers();
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        baseMap,
        if (_usesPlatformMap) ...markers.map(_buildPositionedMarker),
        if (!_usesPlatformMap || _markerPositions.isEmpty)
          ..._buildPreviewMarkers(markers),
        if (_usesPlatformMap && _animationsAllowed && _radarVisible)
          Positioned.fill(
            child: ValueListenableBuilder<Offset?>(
              valueListenable: _radarScreenPosition,
              builder: (context, center, _) {
                if (center == null) return const SizedBox.shrink();
                return AnimatedBuilder(
                  animation: _pulseController,
                  builder:
                      (context, _) => IgnorePointer(
                        child: CustomPaint(
                          painter: _RadarPulsePainter(
                            _pulseController.value,
                            center,
                          ),
                        ),
                      ),
                );
              },
            ),
          ),
        Positioned(
          right: 12,
          bottom: 12,
          child: SafeArea(
            child: MapZoomControls(
              zoomPercentage: widget.runtimeState.zoomPercentage,
              onZoomPercentageChanged: _setZoomPercentage,
              onOpenLayerSettings: widget.onOpenLayerSettings,
              onRequestLocation: widget.onRequestLocation,
              onRecenter: _recenter,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPositionedMarker(MapMarkerData marker) {
    final screen = _markerPositions[marker.key];
    if (screen == null) return const SizedBox.shrink();
    return Positioned(
      key: marker.key,
      left: screen.dx - (marker.width / 2),
      top: screen.dy - (marker.height / 2),
      width: marker.width,
      height: marker.height,
      child: marker.child,
    );
  }

  /// Desktop Flutter does not host the MapLibre platform view. Keep the
  /// provider-neutral marker widgets available there for UI development and
  /// accessibility tests; Android/iOS use the real screen projection above.
  Iterable<Widget> _buildPreviewMarkers(List<MapMarkerData> markers) sync* {
    for (var index = 0; index < markers.length; index += 1) {
      final marker = markers[index];
      final column = index % 6;
      final row = index ~/ 6;
      yield Positioned(
        key: marker.key,
        left: 16 + (column * 44),
        top: 300 + (row * 44),
        width: marker.width,
        height: marker.height,
        child: marker.child,
      );
    }
  }

  Widget _buildMapLibreMap() {
    final initial = MapLibreMapConfig.initialCamera(
      currentLocation: widget.runtimeState.currentLocation,
    );
    return MapLibreMap(
      key: const ValueKey<String>('maplibre-platform-view'),
      styleString: _styleJson!,
      initialCameraPosition: CameraPosition(
        target: _latLng(initial.target),
        zoom: initial.zoom,
      ),
      cameraTargetBounds: CameraTargetBounds.unbounded,
      minMaxZoomPreference: const MinMaxZoomPreference(
        MapLibreMapConfig.minZoom,
        MapLibreMapConfig.maxZoom,
      ),
      compassEnabled: false,
      logoEnabled: false,
      attributionButtonPosition: AttributionButtonPosition.bottomLeft,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      featureTapsTriggersMapClick: false,
      trackCameraPosition: true,
      onMapCreated: (controller) {
        _mapController = controller;
        _queueMarkerRefresh();
      },
      onStyleLoadedCallback: () => unawaited(_onStyleLoaded()),
      onCameraMove: _onCameraMove,
      onCameraIdle: _queueMarkerRefresh,
      onMapIdle: _queueMarkerRefresh,
      onMapClick: _onMapClick,
    );
  }

  Widget _buildPreviewSurface() => ColoredBox(
    color:
        Theme.of(context).brightness == Brightness.dark
            ? const Color(0xFF171B20)
            : const Color(0xFFF2F0EC),
    child: const Center(child: Text('MapLibre 台灣離線地圖預覽')),
  );

  Widget _buildLoadingSurface() => const ColoredBox(
    color: Color(0xFFF2F0EC),
    child: Center(child: CircularProgressIndicator()),
  );

  Widget _buildErrorSurface() => ColoredBox(
    color:
        Theme.of(context).brightness == Brightness.dark
            ? const Color(0xFF171B20)
            : const Color(0xFFF2F0EC),
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '台灣離線地圖資產尚未安裝\n${_styleError ?? '無法載入地圖樣式'}',
          textAlign: TextAlign.center,
        ),
      ),
    ),
  );

  static LatLng _latLng(GeoPoint point) =>
      LatLng(point.latitude, point.longitude);
}

class _RadarPulsePainter extends CustomPainter {
  const _RadarPulsePainter(this.progress, this.center);

  static const Color _radarRed = Color(0xFFD32F2F);

  final double progress;
  final Offset center;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawCircle(center, 6, Paint()..color = _radarRed);
    for (var index = 0; index < 3; index += 1) {
      final phase = (progress + (index / 3)) % 1;
      final opacity = (1 - phase) * 0.72;
      canvas.drawCircle(
        center,
        18 + (phase * 90),
        Paint()
          ..color = _radarRed.withValues(alpha: opacity)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3 - (phase * 1.5),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RadarPulsePainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.center != center;
}
