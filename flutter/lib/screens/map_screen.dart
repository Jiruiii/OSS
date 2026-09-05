import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/map_bridge.dart';
import '../data/location_controller.dart';
import '../data/map_models.dart';
import '../data/map_runtime_state.dart';
import '../data/map_search.dart';
import '../widgets/feature_details_sheet.dart';
import '../widgets/layer_filter_panel.dart';
import '../widgets/map_canvas.dart';
import '../widgets/map_layers.dart' show featureName;

class MapScreen extends StatefulWidget {
  const MapScreen({
    super.key,
    this.staticFeatures,
    this.demoEvents,
    this.initialState,
    this.bridge,
    this.eventUpdates,
    this.networkAvailable = false,
    this.configuredGoogleMapsKey = MapCanvas.compileTimeGoogleMapsKey,
    this.locationController,
    this.themeMode = ThemeMode.system,
    this.animationEnabled = true,
  });

  /// Optional deterministic inputs keep widget tests independent of channels.
  final StaticFeatureCollection? staticFeatures;
  final List<MeshEvent>? demoEvents;
  final MapInitialState? initialState;
  final MapBridge? bridge;
  final Stream<List<MeshEvent>>? eventUpdates;

  /// Tests and keyless builds stay on the asset renderer unless the app shell
  /// explicitly supplies both connectivity and a configured Android Maps key.
  final bool networkAvailable;
  final String configuredGoogleMapsKey;
  final LocationController? locationController;
  final ThemeMode themeMode;
  final bool animationEnabled;

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  late final MapBridge _bridge;
  late final LocationController _locationController;
  final TextEditingController _searchController = TextEditingController();
  StreamSubscription<List<MeshEvent>>? _eventSubscription;
  StreamSubscription<GeoPoint>? _locationSubscription;
  StaticFeatureCollection? _staticFeatures;
  List<MeshEvent> _demoEvents = const <MeshEvent>[];
  List<MeshEvent> _persistedEvents = const <MeshEvent>[];
  bool _showShelters = true;
  bool _showMedical = true;
  bool _showEvents = true;
  bool _emergencyModeEnabled = false;
  StaticFeature? _selectedFeature;
  MeshEvent? _selectedEvent;
  MapRuntimeState _runtimeState = const MapRuntimeState(
    providerMode: MapProviderMode.offline,
    themeMode: ThemeMode.system,
    zoomPercentage: 0,
    currentLocation: null,
    animationEnabled: true,
  );
  MapSearchResult? _searchSelection;
  GeoPoint? _focusPoint;
  String _searchText = '';

  @override
  void initState() {
    super.initState();
    _bridge = widget.bridge ?? MapBridge();
    _locationController = widget.locationController ?? LocationController();
    _locationSubscription = _locationController.locations.listen((location) {
      if (!mounted) return;
      setState(() {
        _runtimeState = _runtimeState.copyWith(currentLocation: location);
      });
    });
    _runtimeState = _runtimeState.copyWith(
      providerMode: _requestedProvider,
      themeMode: widget.themeMode,
      animationEnabled: widget.animationEnabled,
    );
    _load();
  }

  MapProviderMode get _requestedProvider =>
      widget.networkAvailable && widget.configuredGoogleMapsKey.trim().isNotEmpty
          ? MapProviderMode.googleOnline
          : MapProviderMode.offline;

  @override
  void didUpdateWidget(covariant MapScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final providerChanged =
        oldWidget.networkAvailable != widget.networkAvailable ||
        oldWidget.configuredGoogleMapsKey != widget.configuredGoogleMapsKey;
    final preferencesChanged =
        oldWidget.themeMode != widget.themeMode ||
        oldWidget.animationEnabled != widget.animationEnabled;
    if (!providerChanged && !preferencesChanged) return;
    setState(() {
      _runtimeState = _runtimeState.copyWith(
        providerMode: providerChanged ? _requestedProvider : null,
        themeMode: preferencesChanged ? widget.themeMode : null,
        animationEnabled: preferencesChanged ? widget.animationEnabled : null,
      );
    });
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    _locationSubscription?.cancel();
    _searchController.dispose();
    if (widget.locationController == null) {
      unawaited(_locationController.dispose());
    }
    super.dispose();
  }

  Future<void> _load() async {
    final featureFuture =
        widget.staticFeatures == null
            ? _loadStaticFeatures()
            : Future<StaticFeatureCollection>.value(widget.staticFeatures);
    final demoFuture =
        widget.demoEvents == null
            ? _loadDemoEvents()
            : Future<List<MeshEvent>>.value(widget.demoEvents);
    final stateFuture =
        widget.initialState == null
            ? _loadInitialStateSafely()
            : Future<MapInitialState>.value(widget.initialState);
    final values = await Future.wait<Object>(<Future<Object>>[
      featureFuture,
      demoFuture,
    ]);
    if (!mounted) return;
    setState(() {
      _staticFeatures = values[0] as StaticFeatureCollection;
      _demoEvents = values[1] as List<MeshEvent>;
    });
    unawaited(
      stateFuture.then((initialState) {
        if (!mounted) return;
        setState(() {
          _persistedEvents = initialState.events;
          _emergencyModeEnabled = initialState.emergencyModeEnabled;
        });
        _listenForEventUpdates();
      }),
    );
  }

  Future<StaticFeatureCollection> _loadStaticFeatures() async {
    final raw = await rootBundle.loadString(
      'assets/data/neihu/static-features.json',
    );
    return StaticFeatureCollection.fromJson(
      Map<String, dynamic>.from(jsonDecode(raw) as Map),
    );
  }

  Future<List<MeshEvent>> _loadDemoEvents() async {
    final raw = await rootBundle.loadString(
      'assets/data/neihu/demo-events.json',
    );
    final json = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    return eventsFromMessage(json['events']);
  }

  Future<MapInitialState> _loadInitialStateSafely() async {
    try {
      return await _bridge.getInitialState();
    } catch (_) {
      return const MapInitialState(
        events: <MeshEvent>[],
        emergencyModeEnabled: false,
      );
    }
  }

  void _listenForEventUpdates() {
    final updates =
        widget.eventUpdates ??
        (widget.initialState == null ? _bridge.events : null);
    _eventSubscription = updates?.listen((events) {
      if (mounted) setState(() => _persistedEvents = events);
    }, onError: (_) {});
  }

  List<MeshEvent> get _visibleEvents {
    final byId = <String, MeshEvent>{};
    for (final event in _demoEvents) {
      byId[event.eventId ?? 'demo-${byId.length}'] = event;
    }
    for (final event in _persistedEvents) {
      byId[event.eventId ?? 'persisted-${byId.length}'] = event;
    }
    return byId.values.toList(growable: false);
  }

  void _showStaticSelection(List<StaticFeature> features) {
    if (features.length == 1) {
      setState(() {
        _selectedFeature = features.single;
        _selectedEvent = null;
      });
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      builder:
          (context) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('選擇地點', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  ...features.map(
                    (feature) => ListTile(
                      title: Text(featureName(feature)),
                      subtitle: Text(
                        feature.kind == 'medical' ? '醫療院所' : '避難所',
                      ),
                      onTap: () {
                        Navigator.of(context).pop();
                        setState(() {
                          _selectedFeature = feature;
                          _selectedEvent = null;
                        });
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
    );
  }

  void _showEvent(MeshEvent event) => setState(() {
    _selectedEvent = event;
    _selectedFeature = null;
  });

  void _closeDetails() => setState(() {
    _selectedFeature = null;
    _selectedEvent = null;
  });

  Future<void> _openLayerPanel() => showModalBottomSheet<void>(
    context: context,
    builder:
        (context) => StatefulBuilder(
          builder:
              (context, modalSetState) => LayerFilterPanel(
                showShelters: _showShelters,
                showMedical: _showMedical,
                showEvents: _showEvents,
                emergencyModeEnabled: _emergencyModeEnabled,
                onSheltersChanged: (value) {
                  setState(() => _showShelters = value);
                  modalSetState(() {});
                },
                onMedicalChanged: (value) {
                  setState(() => _showMedical = value);
                  modalSetState(() {});
                },
                onEventsChanged: (value) {
                  setState(() => _showEvents = value);
                  modalSetState(() {});
                },
                onEmergencyModeChanged: (value) async {
                  await _setEmergencyMode(value);
                  if (context.mounted) modalSetState(() {});
                },
                onLoadFixture: _loadFixture,
              ),
        ),
  );

  Future<void> _loadFixture() async {
    try {
      final summary = await _bridge.loadBundledFixture();
      if (!mounted) return;
      _showMessage('已處理 ${summary.processed} 筆內建 fixture');
    } catch (_) {
      _showMessage('載入 fixture 需由 Android 主機提供');
    }
  }

  Future<void> _setEmergencyMode(bool enabled) async {
    try {
      final confirmed = await _bridge.setEmergencyMode(enabled: enabled);
      if (mounted) setState(() => _emergencyModeEnabled = confirmed);
    } catch (_) {
      _showMessage('緊急模式需由 Android 主機提供');
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _setZoomPercentage(int percentage) => setState(() {
    _runtimeState = _runtimeState.copyWith(zoomPercentage: percentage);
  });

  void _selectSearchResult(MapSearchResult result) => setState(() {
    _searchSelection = result;
    _focusPoint = result.coordinate;
    _selectedFeature = result.feature;
    _selectedEvent = null;
    _searchText = '';
    _searchController.clear();
  });

  Future<void> _requestCurrentLocation() async {
    final location = await _locationController.requestCurrentLocation();
    if (!mounted) return;
    if (location == null) {
      _showMessage('無法取得目前位置，請確認定位服務與權限');
      return;
    }
    setState(() {
      _focusPoint = location;
      _runtimeState = _runtimeState.copyWith(currentLocation: location);
    });
  }

  @override
  Widget build(BuildContext context) {
    final staticFeatures = _staticFeatures;
    if (staticFeatures == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final searchResults = MapSearchIndex(
      staticFeatures.features,
    ).query(_searchText);
    final activeProvider = MapCanvas.resolveProvider(
      requestedMode: _runtimeState.providerMode,
      configuredGoogleMapsKey: widget.configuredGoogleMapsKey,
      networkAvailable: widget.networkAvailable,
    );
    return Scaffold(
      body: Stack(
        children: <Widget>[
          MapCanvas(
            runtimeState: _runtimeState,
            staticFeatures: staticFeatures.features,
            visibleEvents: _visibleEvents,
            showShelters: _showShelters,
            showMedical: _showMedical,
            showEvents: _showEvents,
            onStaticFeatureSelected: _showStaticSelection,
            onEventSelected: _showEvent,
            onZoomPercentageChanged: _setZoomPercentage,
            onOpenLayerSettings: _openLayerPanel,
            onRequestLocation: _requestCurrentLocation,
            onMapTap: _closeDetails,
            searchSelection: _searchSelection,
            focusPoint: _focusPoint,
            networkAvailable: widget.networkAvailable,
            configuredGoogleMapsKey: widget.configuredGoogleMapsKey,
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _SearchOverlay(
                    text: _searchText,
                    controller: _searchController,
                    results: searchResults,
                    onChanged: (value) => setState(() => _searchText = value),
                    onSelected: _selectSearchResult,
                  ),
                  const SizedBox(height: 8),
                  _StatusOverlay(
                    snapshotAt: staticFeatures.snapshotAt,
                    providerMode: activeProvider,
                  ),
                  const Spacer(),
                ],
              ),
            ),
          ),
          if (_selectedFeature != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: FeatureDetailsSheet.feature(
                feature: _selectedFeature!,
                snapshotAt: staticFeatures.snapshotAt,
                onClose: _closeDetails,
              ),
            ),
          if (_selectedEvent != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: FeatureDetailsSheet.event(
                event: _selectedEvent!,
                onClose: _closeDetails,
              ),
            ),
        ],
      ),
    );
  }
}

class _StatusOverlay extends StatelessWidget {
  const _StatusOverlay({required this.snapshotAt, required this.providerMode});

  final String? snapshotAt;
  final MapProviderMode providerMode;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.94),
      borderRadius: BorderRadius.circular(12),
      boxShadow: const <BoxShadow>[
        BoxShadow(color: Colors.black26, blurRadius: 4),
      ],
    ),
    child: Padding(
      padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('離線地圖可用'),
          Text(
            providerMode == MapProviderMode.googleOnline
                ? 'Google 線上地圖'
                : 'OSM 離線底圖',
          ),
          Text('資料快照：${snapshotAt ?? '無資料'}'),
          const Text(
            '模擬事件，非即時官方災情',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    ),
  );
}

class _SearchOverlay extends StatelessWidget {
  const _SearchOverlay({
    required this.text,
    required this.controller,
    required this.results,
    required this.onChanged,
    required this.onSelected,
  });

  final String text;
  final TextEditingController controller;
  final List<MapSearchResult> results;
  final ValueChanged<String> onChanged;
  final ValueChanged<MapSearchResult> onSelected;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder:
        (context, constraints) => ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: constraints.maxWidth.clamp(0, 480).toDouble(),
          ),
          child: Material(
            color: Theme.of(
              context,
            ).colorScheme.surface.withValues(alpha: 0.96),
            elevation: 4,
            borderRadius: BorderRadius.circular(14),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Semantics(
                  textField: true,
                  label: '搜尋地點',
                  child: TextField(
                    key: const ValueKey<String>('map-search-field'),
                    controller: controller,
                    onChanged: onChanged,
                    textInputAction: TextInputAction.search,
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      hintText: '搜尋醫院、避難所或道路',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                ),
                if (text.trim().isNotEmpty && results.isNotEmpty)
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 220),
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: results.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final result = results[index];
                        final address = result.feature.details['address'];
                        return ListTile(
                          dense: true,
                          title: Text(result.title),
                          subtitle: Text(
                            address is String && address.isNotEmpty
                                ? '${result.typeLabel}・$address'
                                : result.typeLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onTap: () => onSelected(result),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
  );
}
