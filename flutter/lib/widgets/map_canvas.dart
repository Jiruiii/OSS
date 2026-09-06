import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as google;
import 'package:latlong2/latlong.dart' as latlng;

import '../data/map_models.dart';
import '../data/map_defaults.dart';
import '../data/map_runtime_state.dart';
import '../data/map_search.dart';
import '../data/map_zoom.dart';
import 'google_map_layers.dart';
import 'map_layers.dart';
import 'map_zoom_controls.dart';

typedef GoogleMapBuilder = Widget Function(Widget platformMap);

/// Chooses exactly one renderer.  Google tiles are only ever requested by the
/// native Google SDK; the fallback uses packaged OSM assets exclusively.
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
    this.networkAvailable = false,
    this.configuredGoogleMapsKey = compileTimeGoogleMapsKey,
    this.googleMapBuilder,
  });

  /// This is deliberately not an Android manifest key.  A build that chooses
  /// Google rendering passes the same value via --dart-define; no key is kept
  /// in source or in an asset.
  static const String compileTimeGoogleMapsKey = String.fromEnvironment(
    'GOOGLE_MAPS_API_KEY',
    defaultValue: '',
  );

  static const double googleMinZoom = 12;
  static const double googleMaxZoom = 20;
  static const double offlineMinZoom = 12;
  static const double offlineMaxZoom = 17;

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
  final bool networkAvailable;
  final String configuredGoogleMapsKey;
  final GoogleMapBuilder? googleMapBuilder;

  static MapProviderMode resolveProvider({
    required MapProviderMode requestedMode,
    required String configuredGoogleMapsKey,
    required bool networkAvailable,
  }) {
    if (requestedMode == MapProviderMode.googleOnline &&
        configuredGoogleMapsKey.trim().isNotEmpty &&
        networkAvailable) {
      return MapProviderMode.googleOnline;
    }
    return MapProviderMode.offline;
  }

  @override
  State<MapCanvas> createState() => _MapCanvasState();
}

class _MapCanvasState extends State<MapCanvas> with TickerProviderStateMixin {
  static const _googleMapCreationTimeout = Duration(seconds: 4);
  static const _focusAnimationDuration = Duration(milliseconds: 650);
  static const ColorFilter _lightOsmTileFilter = ColorFilter.matrix(<double>[
    1,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ]);
  static const ColorFilter _darkOsmTileFilter = ColorFilter.matrix(<double>[
    0.48,
    0,
    0,
    0,
    0,
    0,
    0.48,
    0,
    0,
    0,
    0,
    0,
    0.48,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ]);
  static const latlng.LatLng _demoCenter = latlng.LatLng(
    MapDefaults.demoLatitude,
    MapDefaults.demoLongitude,
  );
  static final LatLngBounds _offlineBounds = LatLngBounds(
    const latlng.LatLng(25.0518603, 121.5519933),
    const latlng.LatLng(25.1151519, 121.6286149),
  );
  static final google.LatLngBounds _googleBounds = google.LatLngBounds(
    southwest: const google.LatLng(25.0518603, 121.5519933),
    northeast: const google.LatLng(25.1151519, 121.6286149),
  );

  final MapControllerImpl _offlineController = MapControllerImpl();
  final ValueNotifier<Offset?> _radarScreenPosition = ValueNotifier(null);
  late final AnimationController _pulseController;
  google.GoogleMapController? _googleController;
  GoogleMarkerIcons? _googleMarkerIcons;
  String? _googleStyle;
  int _lastFocusRequestId = -1;
  Timer? _googleMapWatchdog;
  bool _googleMapCreated = false;
  bool _googleMapCreationTimedOut = false;
  Timer? _pulseStartTimer;
  Timer? _pulseStopTimer;
  GeoPoint? _pendingEventFocus;
  GeoPoint? _radarEventPoint;
  bool _pendingEventAnimated = true;
  bool _offlineMapReady = false;
  bool _radarVisible = false;
  bool _programmaticGoogleCameraMove = false;

  MapProviderMode _providerFor(MapCanvas canvas) => MapCanvas.resolveProvider(
    requestedMode: canvas.runtimeState.providerMode,
    configuredGoogleMapsKey: canvas.configuredGoogleMapsKey,
    networkAvailable: canvas.networkAvailable,
  );

  MapProviderMode get _activeProvider =>
      _googleMapCreationTimedOut
          ? MapProviderMode.offline
          : _providerFor(widget);

  void _startGoogleMapWatchdog() {
    if (_googleMapCreated ||
        _googleMapCreationTimedOut ||
        _googleMapWatchdog != null ||
        _providerFor(widget) != MapProviderMode.googleOnline) {
      return;
    }
    _googleMapWatchdog = Timer(_googleMapCreationTimeout, () {
      _googleMapWatchdog = null;
      if (!mounted ||
          _googleMapCreated ||
          _providerFor(widget) != MapProviderMode.googleOnline) {
        return;
      }
      setState(() {
        _googleMapCreationTimedOut = true;
        _googleController = null;
      });
    });
  }

  void _resetGoogleMapWatchdog() {
    _googleMapWatchdog?.cancel();
    _googleMapWatchdog = null;
    _googleMapCreated = false;
    _googleMapCreationTimedOut = false;
    _googleController = null;
  }

  void _onGoogleMapCreated(google.GoogleMapController controller) {
    _googleMapWatchdog?.cancel();
    _googleMapWatchdog = null;
    if (!mounted ||
        _googleMapCreationTimedOut ||
        _providerFor(widget) != MapProviderMode.googleOnline) {
      return;
    }
    _googleMapCreated = true;
    _googleController = controller;
    if (_pendingEventFocus != null) {
      _focusPendingEvent();
      return;
    }
    final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
    if (focus != null) _focus(focus, animated: _animationsAllowed);
  }

  bool get _isDarkAppTheme => Theme.of(context).brightness == Brightness.dark;

  ColorFilter get _offlineOsmTileFilter =>
      _isDarkAppTheme ? _darkOsmTileFilter : _lightOsmTileFilter;

  double get _minZoom =>
      _activeProvider == MapProviderMode.googleOnline
          ? MapCanvas.googleMinZoom
          : MapCanvas.offlineMinZoom;
  double get _maxZoom =>
      _activeProvider == MapProviderMode.googleOnline
          ? MapCanvas.googleMaxZoom
          : MapCanvas.offlineMaxZoom;

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
    _loadGoogleStyle();
    if (_googleMarkerIcons == null && mounted) {
      unawaited(_loadGoogleMarkerIcons());
    }
  }

  @override
  void didUpdateWidget(covariant MapCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_providerFor(oldWidget) != _providerFor(widget)) {
      _resetGoogleMapWatchdog();
      _offlineMapReady = false;
    }
    if (oldWidget.runtimeState.themeMode != widget.runtimeState.themeMode) {
      _loadGoogleStyle();
    }
    final focusingNewEvent = _recordNewEvents(oldWidget.visibleEvents);
    final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
    if (!focusingNewEvent &&
        focus != null &&
        widget.focusRequestId != _lastFocusRequestId) {
      _lastFocusRequestId = widget.focusRequestId;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _focus(focus, animated: _animationsAllowed);
      });
    }
  }

  @override
  void dispose() {
    _resetGoogleMapWatchdog();
    _pulseStartTimer?.cancel();
    _pulseStopTimer?.cancel();
    _pulseController.dispose();
    _radarScreenPosition.dispose();
    _offlineController.dispose();
    super.dispose();
  }

  Future<void> _loadGoogleMarkerIcons() async {
    try {
      final icons = await GoogleMarkerIcons.create(
        devicePixelRatio: MediaQuery.devicePixelRatioOf(context),
      );
      if (mounted) setState(() => _googleMarkerIcons = icons);
    } on Object {
      // Feature/event markers remain hidden if neutral bitmap generation is
      // unavailable. The current-location marker has its own fallback.
    }
  }

  Future<void> _loadGoogleStyle() async {
    final brightness = Theme.of(context).brightness;
    final dark =
        widget.runtimeState.themeMode == ThemeMode.dark ||
        (widget.runtimeState.themeMode == ThemeMode.system &&
            brightness == Brightness.dark);
    try {
      final style = await rootBundle.loadString(
        dark
            ? 'assets/map/google-map-dark.json'
            : 'assets/map/google-map-light.json',
      );
      if (mounted) setState(() => _googleStyle = style);
    } on Object {
      // Default Google styling remains usable when a custom style asset fails.
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
      if (mounted) _focusPendingEvent();
    });
    return true;
  }

  bool get _animationsAllowed =>
      widget.runtimeState.animationEnabled &&
      !(MediaQuery.maybeOf(context)?.disableAnimations ?? false);

  void _focusPendingEvent() {
    final focus = _pendingEventFocus;
    if (focus == null || !_focus(focus, animated: _pendingEventAnimated)) {
      return;
    }
    _pendingEventFocus = null;
    if (!_pendingEventAnimated) {
      _stopRadar();
      return;
    }
    _pulseStartTimer?.cancel();
    _pulseStopTimer?.cancel();
    // Both renderers use the same configured camera animation duration. This
    // keeps the Demo radar reliable even when a Google platform view does not
    // emit its camera-idle callback during a short programmatic move.
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

  void _setZoomPercentage(int percentage) {
    final clamped = percentage.clamp(0, 100);
    final zoom = ZoomPercentage.toZoom(
      percentage: clamped,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    widget.onZoomPercentageChanged(clamped);
    if (_activeProvider == MapProviderMode.googleOnline) {
      final controller = _googleController;
      if (controller != null) {
        _programmaticGoogleCameraMove = true;
        unawaited(controller.animateCamera(google.CameraUpdate.zoomTo(zoom)));
      }
      return;
    }
    _offlineController.move(_offlineController.camera.center, zoom);
  }

  void _recenter() {
    widget.onRecenter?.call();
    widget.onZoomPercentageChanged(0);
    if (_activeProvider == MapProviderMode.googleOnline) {
      final controller = _googleController;
      if (controller != null) {
        _programmaticGoogleCameraMove = true;
        unawaited(
          controller.animateCamera(
            google.CameraUpdate.newLatLngBounds(_googleBounds, 28),
          ),
        );
      }
      return;
    }
    _offlineController.move(_demoCenter, MapCanvas.offlineMinZoom);
  }

  bool _focus(GeoPoint point, {required bool animated}) {
    const focusPercentage = 70;
    final zoom = ZoomPercentage.toZoom(
      percentage: focusPercentage,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    if (_activeProvider == MapProviderMode.googleOnline) {
      final controller = _googleController;
      if (controller == null) return false;
      final update = google.CameraUpdate.newCameraPosition(
        google.CameraPosition(
          target: google.LatLng(point.latitude, point.longitude),
          zoom: zoom,
        ),
      );
      widget.onZoomPercentageChanged(focusPercentage);
      _programmaticGoogleCameraMove = true;
      unawaited(
        animated
            ? controller.animateCamera(update)
            : controller.moveCamera(update),
      );
      return true;
    }
    if (!_offlineMapReady) return false;
    widget.onZoomPercentageChanged(focusPercentage);
    final target = latlng.LatLng(point.latitude, point.longitude);
    if (animated) {
      _offlineController.moveAnimatedRaw(
        target,
        zoom,
        duration: _focusAnimationDuration,
        curve: Curves.easeInOutCubic,
        hasGesture: false,
        source: MapEventSource.mapController,
      );
    } else {
      _offlineController.move(target, zoom);
    }
    return true;
  }

  void _onGoogleCameraMove(google.CameraPosition position) {
    if (_programmaticGoogleCameraMove) return;
    final percentage = ZoomPercentage.fromZoom(
      zoom: position.zoom,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    if (percentage != widget.runtimeState.zoomPercentage) {
      widget.onZoomPercentageChanged(percentage);
    }
  }

  Future<bool> _updateRadarScreenPosition(GeoPoint point) async {
    if (_activeProvider == MapProviderMode.googleOnline) {
      // Google uses native Circle overlays, so it does not need a Flutter
      // screen projection for the radar.
      return true;
    }
    if (!_offlineMapReady) return false;
    final camera = _offlineController.camera;
    _radarScreenPosition.value = camera.latLngToScreenOffset(
      latlng.LatLng(point.latitude, point.longitude),
    );
    return true;
  }

  void _onOfflineMapEvent(MapEvent event) {
    final radarPoint = _radarEventPoint;
    if (radarPoint != null) unawaited(_updateRadarScreenPosition(radarPoint));
    if (event.source == MapEventSource.mapController) return;
    final percentage = ZoomPercentage.fromZoom(
      zoom: event.camera.zoom,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    if (percentage != widget.runtimeState.zoomPercentage) {
      widget.onZoomPercentageChanged(percentage);
    }
  }

  @override
  Widget build(BuildContext context) {
    final map =
        _activeProvider == MapProviderMode.googleOnline
            ? _buildGoogleMap()
            : _buildOfflineMap();
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        map,
        if (_activeProvider == MapProviderMode.offline &&
            _animationsAllowed &&
            _radarVisible)
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
          )
        else
          const SizedBox.shrink(),
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

  Widget _buildGoogleMap() {
    _startGoogleMapWatchdog();
    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, _) => _buildGoogleMapFrame(_pulseController.value),
    );
  }

  Widget _buildGoogleMapFrame(double radarProgress) {
    final overlays = GoogleMapLayers.build(
      features: widget.staticFeatures,
      events: widget.visibleEvents,
      showShelters: widget.showShelters,
      showMedical: widget.showMedical,
      showEvents: widget.showEvents,
      onStaticFeatureSelected: widget.onStaticFeatureSelected,
      onEventSelected: widget.onEventSelected,
      markerIcons: _googleMarkerIcons,
      currentLocation: widget.runtimeState.currentLocation,
      radarPoint: _radarVisible ? _radarEventPoint : null,
      radarProgress: radarProgress,
    );
    final platformMap = google.GoogleMap(
      key: const ValueKey<String>('google-map-platform-view'),
      initialCameraPosition: google.CameraPosition(
        target: const google.LatLng(
          MapDefaults.demoLatitude,
          MapDefaults.demoLongitude,
        ),
        zoom: ZoomPercentage.toZoom(
          percentage: widget.runtimeState.zoomPercentage,
          minZoom: MapCanvas.googleMinZoom,
          maxZoom: MapCanvas.googleMaxZoom,
        ),
      ),
      cameraTargetBounds: google.CameraTargetBounds(_googleBounds),
      minMaxZoomPreference: const google.MinMaxZoomPreference(
        MapCanvas.googleMinZoom,
        MapCanvas.googleMaxZoom,
      ),
      style: _googleStyle,
      zoomControlsEnabled: false,
      zoomGesturesEnabled: true,
      scrollGesturesEnabled: true,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      // The Demo owns its current-location marker. Enabling Google's native
      // layer here could show a second emulator GPS position.
      myLocationEnabled: false,
      myLocationButtonEnabled: false,
      markers: overlays.markers,
      polylines: overlays.polylines,
      polygons: overlays.polygons,
      circles: overlays.circles,
      onMapCreated: _onGoogleMapCreated,
      onCameraMove: _onGoogleCameraMove,
      onCameraIdle: () {
        _programmaticGoogleCameraMove = false;
      },
      onTap: (_) => widget.onMapTap(),
    );
    return widget.googleMapBuilder?.call(platformMap) ?? platformMap;
  }

  Widget _buildOfflineMap() => FlutterMap(
    mapController: _offlineController,
    options: MapOptions(
      initialCenter: _demoCenter,
      initialZoom: ZoomPercentage.toZoom(
        percentage: widget.runtimeState.zoomPercentage,
        minZoom: MapCanvas.offlineMinZoom,
        maxZoom: MapCanvas.offlineMaxZoom,
      ),
      minZoom: MapCanvas.offlineMinZoom,
      maxZoom: MapCanvas.offlineMaxZoom,
      cameraConstraint: CameraConstraint.containCenter(bounds: _offlineBounds),
      interactionOptions: const InteractionOptions(
        flags:
            InteractiveFlag.drag |
            InteractiveFlag.flingAnimation |
            InteractiveFlag.pinchMove |
            InteractiveFlag.pinchZoom |
            InteractiveFlag.doubleTapZoom |
            InteractiveFlag.doubleTapDragZoom,
        enableMultiFingerGestureRace: true,
      ),
      onMapEvent: _onOfflineMapEvent,
      onTap: (_, _) => widget.onMapTap(),
      onMapReady: () {
        _offlineMapReady = true;
        if (_pendingEventFocus != null) {
          _focusPendingEvent();
          return;
        }
        final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
        if (focus != null) _focus(focus, animated: _animationsAllowed);
      },
    ),
    children: <Widget>[
      ColorFiltered(
        colorFilter: _offlineOsmTileFilter,
        child: TileLayer(
          urlTemplate: 'assets/map/tiles/{z}/{x}/{y}.png',
          tileProvider: AssetTileProvider(),
          minZoom: MapCanvas.offlineMinZoom,
          maxZoom: MapCanvas.offlineMaxZoom,
          minNativeZoom: 12,
          maxNativeZoom: 17,
          tileBounds: _offlineBounds,
          keepBuffer: 0,
          panBuffer: 0,
          tileDisplay: const TileDisplay.instantaneous(),
        ),
      ),
      ...MapLayers.build(
        features: widget.staticFeatures,
        events: widget.visibleEvents,
        showShelters: widget.showShelters,
        showMedical: widget.showMedical,
        showEvents: widget.showEvents,
        onStaticFeatureSelected: widget.onStaticFeatureSelected,
        onEventSelected: widget.onEventSelected,
        currentLocation: widget.runtimeState.currentLocation,
      ),
      const Positioned(
        right: 8,
        bottom: 8,
        child: IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(color: Colors.white70),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              child: Text(
                '© OpenStreetMap contributors',
                style: TextStyle(fontSize: 10, color: Colors.black87),
              ),
            ),
          ),
        ),
      ),
    ],
  );
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
      oldDelegate.progress != progress;
}
