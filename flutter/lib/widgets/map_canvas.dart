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

  final MapController _offlineController = MapController();
  late final AnimationController _pulseController;
  google.GoogleMapController? _googleController;
  GoogleMarkerIcons? _googleMarkerIcons;
  String? _googleStyle;
  String? _lastFocusKey;
  final Set<String> _knownEventKeys = <String>{};
  final Set<String> _pulsingEventKeys = <String>{};
  Timer? _pulseStopTimer;

  MapProviderMode get _activeProvider => MapCanvas.resolveProvider(
    requestedMode: widget.runtimeState.providerMode,
    configuredGoogleMapsKey: widget.configuredGoogleMapsKey,
    networkAvailable: widget.networkAvailable,
  );

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
    _knownEventKeys.addAll(widget.visibleEvents.map(eventKey));
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 750),
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
    if (oldWidget.runtimeState.themeMode != widget.runtimeState.themeMode) {
      _loadGoogleStyle();
    }
    _recordNewEvents(oldWidget.visibleEvents);
    final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
    if (focus != null) {
      final focusKey = '${focus.latitude}:${focus.longitude}';
      if (focusKey != _lastFocusKey) {
        _lastFocusKey = focusKey;
        WidgetsBinding.instance.addPostFrameCallback((_) => _focus(focus));
      }
    }
  }

  @override
  void dispose() {
    _pulseStopTimer?.cancel();
    _pulseController.dispose();
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
      // The SDK fallback remains type/severity neutral if local bitmap
      // generation is unavailable. This does not make a network request.
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

  void _recordNewEvents(List<MeshEvent> oldEvents) {
    final oldKeys = oldEvents.map(eventKey).toSet();
    final newKeys = widget.visibleEvents
        .map(eventKey)
        .toSet()
        .difference(oldKeys);
    _knownEventKeys.addAll(widget.visibleEvents.map(eventKey));
    if (newKeys.isEmpty ||
        !widget.runtimeState.animationEnabled ||
        (MediaQuery.maybeOf(context)?.disableAnimations ?? false)) {
      return;
    }
    setState(() => _pulsingEventKeys.addAll(newKeys));
    _pulseController
      ..reset()
      ..repeat(reverse: true);
    _pulseStopTimer?.cancel();
    _pulseStopTimer = Timer(const Duration(milliseconds: 1500), () {
      if (!mounted) return;
      setState(_pulsingEventKeys.clear);
      _pulseController.stop();
    });
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
      _googleController?.animateCamera(google.CameraUpdate.zoomTo(zoom));
      return;
    }
    _offlineController.move(_offlineController.camera.center, zoom);
  }

  void _recenter() {
    widget.onRecenter?.call();
    widget.onZoomPercentageChanged(0);
    if (_activeProvider == MapProviderMode.googleOnline) {
      _googleController?.animateCamera(
        google.CameraUpdate.newLatLngBounds(_googleBounds, 28),
      );
      return;
    }
    _offlineController.move(_demoCenter, MapCanvas.offlineMinZoom);
  }

  void _focus(GeoPoint point) {
    const focusPercentage = 70;
    widget.onZoomPercentageChanged(focusPercentage);
    final zoom = ZoomPercentage.toZoom(
      percentage: focusPercentage,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    if (_activeProvider == MapProviderMode.googleOnline) {
      _googleController?.animateCamera(
        google.CameraUpdate.newCameraPosition(
          google.CameraPosition(
            target: google.LatLng(point.latitude, point.longitude),
            zoom: zoom,
          ),
        ),
      );
      return;
    }
    _offlineController.move(
      latlng.LatLng(point.latitude, point.longitude),
      zoom,
    );
  }

  void _onGoogleCameraMove(google.CameraPosition position) {
    final percentage = ZoomPercentage.fromZoom(
      zoom: position.zoom,
      minZoom: _minZoom,
      maxZoom: _maxZoom,
    );
    if (percentage != widget.runtimeState.zoomPercentage) {
      widget.onZoomPercentageChanged(percentage);
    }
  }

  void _onOfflineMapEvent(MapEvent event) {
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
    final animationsAllowed =
        widget.runtimeState.animationEnabled &&
        !MediaQuery.disableAnimationsOf(context);
    return Stack(
      children: <Widget>[
        if (animationsAllowed && _pulsingEventKeys.isNotEmpty)
          AnimatedBuilder(
            animation: _pulseController,
            builder:
                (context, child) => _buildMapWithPulse(_pulseController.value),
          )
        else
          _buildMapWithPulse(0),
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

  Widget _buildMapWithPulse(double pulseFraction) {
    // The renderer reads the animation only while a short new-event pulse is
    // active; MapScreen and its EventChannel subscription stay untouched.
    return _activeProvider == MapProviderMode.googleOnline
        ? _buildGoogleMap(pulseFraction: pulseFraction)
        : _buildOfflineMap(pulseFraction: pulseFraction);
  }

  Widget _buildGoogleMap({double pulseFraction = 0}) {
    final overlays = GoogleMapLayers.build(
      features: widget.staticFeatures,
      events: widget.visibleEvents,
      showShelters: widget.showShelters,
      showMedical: widget.showMedical,
      showEvents: widget.showEvents,
      onStaticFeatureSelected: widget.onStaticFeatureSelected,
      onEventSelected: widget.onEventSelected,
      pulsingEventKeys: _pulsingEventKeys,
      pulseFraction: pulseFraction,
      markerIcons: _googleMarkerIcons,
      currentLocation: widget.runtimeState.currentLocation,
    );
    final platformMap = google.GoogleMap(
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
      myLocationEnabled: widget.runtimeState.currentLocation != null,
      myLocationButtonEnabled: false,
      markers: overlays.markers,
      polylines: overlays.polylines,
      polygons: overlays.polygons,
      circles: overlays.circles,
      onMapCreated: (controller) {
        _googleController = controller;
        final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
        if (focus != null) _focus(focus);
      },
      onCameraMove: _onGoogleCameraMove,
      onTap: (_) => widget.onMapTap(),
    );
    return widget.googleMapBuilder?.call(platformMap) ?? platformMap;
  }

  Widget _buildOfflineMap({double pulseFraction = 0}) => FlutterMap(
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
        final focus = widget.focusPoint ?? widget.searchSelection?.coordinate;
        if (focus != null) _focus(focus);
      },
    ),
    children: <Widget>[
      TileLayer(
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
      ...MapLayers.build(
        features: widget.staticFeatures,
        events: widget.visibleEvents,
        showShelters: widget.showShelters,
        showMedical: widget.showMedical,
        showEvents: widget.showEvents,
        onStaticFeatureSelected: widget.onStaticFeatureSelected,
        onEventSelected: widget.onEventSelected,
        currentLocation: widget.runtimeState.currentLocation,
        pulsingEventKeys: _pulsingEventKeys,
        pulseFraction: pulseFraction,
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
