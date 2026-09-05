import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../data/map_bridge.dart';
import '../data/map_models.dart';
import '../widgets/feature_details_sheet.dart';
import '../widgets/layer_filter_panel.dart';
import '../widgets/map_layers.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({
    super.key,
    this.staticFeatures,
    this.demoEvents,
    this.initialState,
    this.bridge,
    this.eventUpdates,
  });

  /// Optional deterministic inputs keep widget tests independent of channels.
  final StaticFeatureCollection? staticFeatures;
  final List<MeshEvent>? demoEvents;
  final MapInitialState? initialState;
  final MapBridge? bridge;
  final Stream<List<MeshEvent>>? eventUpdates;

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  static final LatLngBounds _neihuBounds = LatLngBounds(
    const LatLng(25.0518603, 121.5519933),
    const LatLng(25.1151519, 121.6286149),
  );

  final MapController _mapController = MapController();
  late final MapBridge _bridge;
  StreamSubscription<List<MeshEvent>>? _eventSubscription;
  StaticFeatureCollection? _staticFeatures;
  List<MeshEvent> _demoEvents = const <MeshEvent>[];
  List<MeshEvent> _persistedEvents = const <MeshEvent>[];
  bool _showShelters = true;
  bool _showMedical = true;
  bool _showEvents = true;
  bool _emergencyModeEnabled = false;
  StaticFeature? _selectedFeature;
  MeshEvent? _selectedEvent;

  @override
  void initState() {
    super.initState();
    _bridge = widget.bridge ?? MapBridge();
    _load();
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    _mapController.dispose();
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
        (context) => LayerFilterPanel(
          showShelters: _showShelters,
          showMedical: _showMedical,
          showEvents: _showEvents,
          emergencyModeEnabled: _emergencyModeEnabled,
          onSheltersChanged: (value) => setState(() => _showShelters = value),
          onMedicalChanged: (value) => setState(() => _showMedical = value),
          onEventsChanged: (value) => setState(() => _showEvents = value),
          onEmergencyModeChanged: _setEmergencyMode,
          onLoadFixture: _loadFixture,
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

  void _recenter() => _mapController.fitCamera(
    CameraFit.bounds(
      bounds: _neihuBounds,
      padding: const EdgeInsets.all(36),
      minZoom: 12,
      maxZoom: 17,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final staticFeatures = _staticFeatures;
    if (staticFeatures == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      body: Stack(
        children: <Widget>[
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: const LatLng(25.083506, 121.590304),
              initialZoom: 13,
              initialCameraFit: CameraFit.bounds(
                bounds: _neihuBounds,
                padding: const EdgeInsets.all(24),
                minZoom: 12,
                maxZoom: 17,
              ),
              minZoom: 12,
              maxZoom: 17,
              onTap: (_, _) => _closeDetails(),
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: 'assets/map/tiles/{z}/{x}/{y}.png',
                tileProvider: AssetTileProvider(),
                minZoom: 12,
                maxZoom: 17,
                minNativeZoom: 12,
                maxNativeZoom: 17,
                keepBuffer: 0,
                panBuffer: 0,
                tileDisplay: const TileDisplay.instantaneous(),
              ),
              ...MapLayers.build(
                features: staticFeatures.features,
                events: _visibleEvents,
                showShelters: _showShelters,
                showMedical: _showMedical,
                showEvents: _showEvents,
                onStaticFeatureSelected: _showStaticSelection,
                onEventSelected: _showEvent,
              ),
              const SimpleAttributionWidget(
                source: Text('OpenStreetMap contributors'),
              ),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _StatusOverlay(snapshotAt: staticFeatures.snapshotAt),
                  const Spacer(),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Semantics(
                          button: true,
                          label: '圖層設定',
                          onTap: _openLayerPanel,
                          child: ExcludeSemantics(
                            child: FloatingActionButton.small(
                              heroTag: 'layer-filter',
                              tooltip: '圖層設定',
                              onPressed: _openLayerPanel,
                              child: const Icon(Icons.layers_outlined),
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Semantics(
                          button: true,
                          label: '回到內湖範圍',
                          onTap: _recenter,
                          child: ExcludeSemantics(
                            child: FloatingActionButton.small(
                              heroTag: 'recenter-neihu',
                              tooltip: '回到內湖範圍',
                              onPressed: _recenter,
                              child: const Icon(Icons.my_location),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
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
  const _StatusOverlay({required this.snapshotAt});

  final String? snapshotAt;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface.withOpacity(0.94),
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
