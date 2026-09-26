import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../data/map_bridge.dart';
import '../data/attestation_index.dart';
import '../data/bridge_failure.dart';
import '../data/corroboration.dart';
import '../data/crowd_report_models.dart';
import '../data/display_time.dart';
import '../data/evacuation_models.dart';
import '../data/location_controller.dart';
import '../data/map_administrative.dart';
import '../data/map_models.dart';
import '../data/maplibre_map_config.dart';
import '../data/map_runtime_state.dart';
import '../data/map_search.dart';
import '../data/map_search_asset.dart';
import '../data/ncdr_map_filter.dart';
import '../data/offline_map_asset_store.dart';
import '../widgets/feature_details_sheet.dart';
import '../widgets/crowd_report_sheet.dart';
import '../widgets/evacuation_route_sheet.dart';
import '../widgets/layer_filter_panel.dart';
import '../widgets/map_canvas.dart';
import '../widgets/map_layers.dart' show MapIconCatalog, featureName;

class MapScreen extends StatefulWidget {
  const MapScreen({
    super.key,
    this.staticFeatures,
    this.staticFeaturesPending = false,
    this.staticFeaturesFailed = false,
    this.initialState,
    this.bridge,
    this.eventUpdates,
    this.locationController,
    this.themeMode = ThemeMode.system,
    this.animationEnabled = true,
  });

  /// Optional deterministic inputs keep widget tests independent of channels.
  final StaticFeatureCollection? staticFeatures;

  /// Android is still verifying the nationwide layers (first launch only).
  final bool staticFeaturesPending;

  /// Verification failed; nothing unverified is shown instead.
  final bool staticFeaturesFailed;
  final MapInitialState? initialState;
  final MapBridge? bridge;
  final Stream<List<MeshEvent>>? eventUpdates;

  /// Tests can inject deterministic data and a fake location controller.
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
  final TextEditingController _reportAddressController =
      TextEditingController();
  StreamSubscription<List<MeshEvent>>? _eventSubscription;
  StreamSubscription<GeoPoint>? _locationSubscription;
  StaticFeatureCollection? _staticFeatures;
  MapAdministrativeIndex? _administrativeIndex;
  TaiwanSearchAsset? _searchAsset;
  MapSearchIndex? _searchIndex;
  Timer? _mapSearchDebounce;
  Timer? _reportAddressSearchDebounce;
  List<MeshEvent> _persistedEvents = const <MeshEvent>[];
  bool _showShelters = true;
  bool _showMedical = true;
  bool _showEvents = true;
  bool _emergencyModeEnabled = false;
  StaticFeature? _selectedFeature;
  MeshEvent? _selectedEvent;
  MapRuntimeState _runtimeState = const MapRuntimeState(
    themeMode: ThemeMode.system,
    zoomPercentage: MapLibreMapConfig.initialOverviewPercentage,
    currentLocation: null,
    animationEnabled: true,
  );
  MapSearchResult? _searchSelection;
  GeoPoint? _focusPoint;
  int _focusRequestId = 0;
  String _searchText = '';
  CrowdReportDraft? _reportDraft;
  CrowdReportSheetStep _reportStep = CrowdReportSheetStep.edit;
  bool _reportSheetVisible = false;
  bool _reportPicking = false;
  bool _reportSubmitting = false;
  String? _reportDeliveryEventId;
  StaticFeature? _routeDestination;
  EvacuationRouteResult? _routeResult;
  String? _routeErrorMessage;
  String? _routeEventFingerprint;
  bool _routeSheetVisible = false;
  bool _routeLoading = false;
  bool _routeStale = false;
  String? _routeLoadingMessage;
  int _routeRequestToken = 0;

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
      themeMode: widget.themeMode,
      animationEnabled: widget.animationEnabled,
    );
    _load();
  }

  @override
  void didUpdateWidget(covariant MapScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextFeatures = widget.staticFeatures;
    if (nextFeatures != null &&
        !identical(oldWidget.staticFeatures, nextFeatures)) {
      // Verified layers can arrive after the first frame (see
      // MapAppController._loadVerifiedStaticFeatures).
      setState(() {
        _staticFeatures = nextFeatures;
        _rebuildSearchIndex();
      });
    }
    final preferencesChanged =
        oldWidget.themeMode != widget.themeMode ||
        oldWidget.animationEnabled != widget.animationEnabled;
    if (!preferencesChanged) return;
    setState(() {
      _runtimeState = _runtimeState.copyWith(
        themeMode: preferencesChanged ? widget.themeMode : null,
        animationEnabled: preferencesChanged ? widget.animationEnabled : null,
      );
    });
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    _locationSubscription?.cancel();
    _mapSearchDebounce?.cancel();
    _reportAddressSearchDebounce?.cancel();
    _searchController.dispose();
    _reportAddressController.dispose();
    if (widget.locationController == null) {
      unawaited(_locationController.dispose());
    }
    super.dispose();
  }

  Future<void> _load() async {
    unawaited(_loadSearchAssetInBackground());
    final featureFuture =
        widget.staticFeatures == null
            ? _loadStaticFeatures()
            : Future<StaticFeatureCollection>.value(widget.staticFeatures);
    final stateFuture =
        widget.initialState == null
            ? _loadInitialStateSafely()
            : Future<MapInitialState>.value(widget.initialState);
    final administrativeFuture = _loadAdministrativeIndexSafely();
    final staticFeatures = await featureFuture;
    if (!mounted) return;
    setState(() {
      // A newer collection may have arrived through didUpdateWidget meanwhile.
      _staticFeatures = widget.staticFeatures ?? staticFeatures;
      _rebuildSearchIndex();
    });
    unawaited(
      administrativeFuture.then((administrativeIndex) {
        if (!mounted) return;
        setState(() {
          _administrativeIndex = administrativeIndex;
          _rebuildSearchIndex();
        });
      }),
    );
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
      'assets/data/taiwan/static-features.json',
    );
    return StaticFeatureCollection.fromJson(
      Map<String, dynamic>.from(jsonDecode(raw) as Map),
    );
  }

  Future<TaiwanSearchAsset> _loadSearchAsset() async {
    final raw = await rootBundle.loadString(
      'assets/map/search/taiwan-roads.json',
    );
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      throw const FormatException('Taiwan search asset root must be an object');
    }
    return TaiwanSearchAsset.fromJson(Map<String, dynamic>.from(decoded));
  }

  Future<MapAdministrativeIndex?> _loadAdministrativeIndexSafely() async {
    try {
      final raw = await rootBundle.loadString(
        OfflineMapAssetStore.referenceLabelsAsset,
      );
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return MapAdministrativeIndex.fromJson(
        Map<String, dynamic>.from(decoded),
      );
    } on Object {
      return null;
    }
  }

  Future<void> _loadSearchAssetInBackground() async {
    try {
      final asset = await _loadSearchAsset();
      if (!mounted) return;
      setState(() {
        _searchAsset = asset;
        _rebuildSearchIndex();
      });
    } on Object {
      // Static facilities and the map remain usable if the optional search
      // index asset is unavailable; no online fallback is introduced.
    }
  }

  void _rebuildSearchIndex() {
    final staticFeatures = _staticFeatures;
    if (staticFeatures == null) {
      _searchIndex = null;
      return;
    }
    _searchIndex = MapSearchIndex(
      staticFeatures.features,
      roadEntries: _searchAsset?.entries ?? const <TaiwanSearchEntry>[],
      administrativeAreas:
          _administrativeIndex?.searchableAreas ??
          const <MapAdministrativeArea>[],
    );
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
    _eventSubscription = updates?.listen(_applyEventSnapshot, onError: (_) {});
  }

  void _applyEventSnapshot(List<MeshEvent> events) {
    if (!mounted) return;
    final changedSinceRouteStart =
        _routeDestination != null &&
        _routeEventFingerprint != null &&
        _eventFingerprint(events) != _routeEventFingerprint;
    setState(() {
      _persistedEvents = events;
      if (changedSinceRouteStart) _routeStale = true;
    });
  }

  List<MeshEvent> get _visibleEvents {
    final byId = <String, MeshEvent>{};
    for (final event in _persistedEvents) {
      byId[meshEventIdentity(event)] = event;
    }
    final now = DateTime.now().toUtc();
    return AttestationIndex.fromEvents(byId.values, now: now)
        .mapDisplayEvents(byId.values)
        .where((event) => event.isShownAt(now))
        .where(isMapVisibleEvent)
        .toList(growable: false);
  }

  String? _corroborationOf(MeshEvent event) =>
      corroborationLabel(corroborationCount(event, _persistedEvents));

  void _showStaticSelection(List<StaticFeature> features) {
    if (features.isEmpty) return;
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

  Future<void> _calculateRouteTo(StaticFeature shelter) async {
    if (_routeLoading) return;
    final requestToken = ++_routeRequestToken;
    final eventFingerprint = _eventFingerprint(_persistedEvents);
    setState(() {
      _routeDestination = shelter;
      _routeEventFingerprint = eventFingerprint;
      _routeResult = null;
      _routeErrorMessage = null;
      _routeLoading = true;
      _routeStale = false;
      _routeLoadingMessage = null;
      _routeSheetVisible = true;
      _selectedFeature = null;
      _selectedEvent = null;
    });

    final geometry = shelter.geometry;
    final shelterId = shelter.id;
    final shelterPoint = geometry is PointGeometry ? geometry.point : null;
    if (shelterId == null || shelterId.isEmpty || shelterPoint == null) {
      if (!mounted || requestToken != _routeRequestToken) return;
      setState(() {
        _routeLoading = false;
        _routeLoadingMessage = null;
        _routeResult = _invalidRouteResult;
      });
      return;
    }

    var origin = _runtimeState.currentLocation;
    if (origin == null) {
      origin = await _locationController.requestCurrentLocation();
      if (!mounted || requestToken != _routeRequestToken) return;
      if (origin == null) {
        setState(() {
          _routeLoading = false;
          _routeLoadingMessage = null;
          _routeErrorMessage = '無法取得目前位置，請開啟瀏覽器或裝置定位權限';
        });
        return;
      }
      setState(() {
        _runtimeState = _runtimeState.copyWith(currentLocation: origin);
      });
    }

    try {
      final result = await _bridge.calculateEvacuationRoute(
        origin: origin,
        destination: ShelterRouteCandidate(
          id: shelterId,
          location: shelterPoint,
        ),
      );
      if (!mounted || requestToken != _routeRequestToken) return;
      final stale = _eventFingerprint(_persistedEvents) != eventFingerprint;
      setState(() {
        _routeLoading = false;
        _routeLoadingMessage = null;
        _routeErrorMessage = null;
        _routeResult = result;
        _routeStale = stale;
      });
    } on Object catch (error) {
      if (!mounted || requestToken != _routeRequestToken) return;
      setState(() {
        _routeLoading = false;
        _routeLoadingMessage = null;
        _routeResult = null;
        _routeErrorMessage = _routeErrorMessageFor(error);
      });
    }
  }

  Future<void> _recommendNearestShelter() async {
    if (_routeLoading) return;
    final requestToken = ++_routeRequestToken;
    final eventFingerprint = _eventFingerprint(_persistedEvents);
    setState(() {
      _routeDestination = null;
      _routeEventFingerprint = eventFingerprint;
      _routeResult = null;
      _routeErrorMessage = null;
      _routeLoading = true;
      _routeLoadingMessage = null;
      _routeStale = false;
      _routeSheetVisible = true;
      _selectedFeature = null;
      _selectedEvent = null;
    });

    var origin = _runtimeState.currentLocation;
    if (origin == null) {
      origin = await _locationController.requestCurrentLocation();
      if (!mounted || requestToken != _routeRequestToken) return;
      if (origin == null) {
        setState(() {
          _routeLoading = false;
          _routeErrorMessage = '無法取得目前位置，請開啟瀏覽器或裝置定位權限';
        });
        return;
      }
      setState(() {
        _runtimeState = _runtimeState.copyWith(currentLocation: origin);
      });
    }

    final features = _staticFeatures?.features ?? const <StaticFeature>[];
    final candidates = shortlistShelterCandidates(origin, features);
    if (candidates.isEmpty) {
      if (!mounted || requestToken != _routeRequestToken) return;
      setState(() {
        _routeLoading = false;
        _routeErrorMessage = '目前沒有可推薦的避難所';
      });
      return;
    }
    final featuresById = <String, StaticFeature>{
      for (final feature in features)
        if (feature.id != null) feature.id!: feature,
    };

    EvacuationRouteResult? bestRoute;
    StaticFeature? bestFeature;
    for (var index = 0; index < candidates.length; index += 1) {
      if (!mounted || requestToken != _routeRequestToken) return;
      if (_eventFingerprint(_persistedEvents) != eventFingerprint) {
        _finishRecommendationWithError(requestToken, '事件資料已更新，請重新計算推薦避難所');
        return;
      }
      setState(() {
        _routeLoadingMessage = '正在比較可達避難所（${index + 1}/${candidates.length}）';
      });

      EvacuationRouteResult result;
      try {
        result = await _bridge.calculateEvacuationRoute(
          origin: origin,
          destination: candidates[index],
        );
      } on Object catch (error) {
        if (!mounted || requestToken != _routeRequestToken) return;
        _finishRecommendationWithError(
          requestToken,
          _routeErrorMessageFor(error),
        );
        return;
      }
      if (!mounted || requestToken != _routeRequestToken) return;
      if (_eventFingerprint(_persistedEvents) != eventFingerprint) {
        _finishRecommendationWithError(requestToken, '事件資料已更新，請重新計算推薦避難所');
        return;
      }

      if (result.status == EvacuationRouteStatus.noRoute) continue;
      if (result.status != EvacuationRouteStatus.ok) {
        setState(() {
          _routeLoading = false;
          _routeLoadingMessage = null;
          _routeResult = result;
          _routeErrorMessage = null;
        });
        return;
      }
      final distance = result.distanceM;
      if (distance == null || !distance.isFinite || distance < 0) {
        _finishRecommendationWithError(requestToken, '路線資料格式錯誤，未顯示路線');
        return;
      }
      if (bestRoute == null || distance < bestRoute.distanceM!) {
        bestRoute = result;
        bestFeature = featuresById[candidates[index].id];
      }
    }

    if (!mounted || requestToken != _routeRequestToken) return;
    if (_eventFingerprint(_persistedEvents) != eventFingerprint) {
      _finishRecommendationWithError(requestToken, '事件資料已更新，請重新計算推薦避難所');
      return;
    }
    setState(() {
      _routeLoading = false;
      _routeLoadingMessage = null;
      _routeResult = bestRoute ?? _noRouteResult;
      _routeDestination = bestFeature;
      _routeErrorMessage = null;
    });
  }

  void _finishRecommendationWithError(int requestToken, String message) {
    if (!mounted || requestToken != _routeRequestToken) return;
    setState(() {
      _routeLoading = false;
      _routeLoadingMessage = null;
      _routeResult = null;
      _routeErrorMessage = message;
      _routeStale = false;
    });
  }

  void _closeRoute() {
    // Incrementing the token means a late native response cannot reopen or
    // replace a route the user dismissed.
    _routeRequestToken += 1;
    setState(() {
      _routeDestination = null;
      _routeResult = null;
      _routeErrorMessage = null;
      _routeEventFingerprint = null;
      _routeSheetVisible = false;
      _routeLoading = false;
      _routeLoadingMessage = null;
      _routeStale = false;
    });
  }

  String _routeErrorMessageFor(Object error) => switch (error) {
    BridgeFailure(:final code) => switch (code) {
      BridgeFailureCode.unavailable => '此功能需要 Android App，Chrome 僅供地圖與資料預覽',
      BridgeFailureCode.graphUnavailable => '離線路網尚未載入',
      BridgeFailureCode.invalidInput => '起點或避難所資料不完整',
      BridgeFailureCode.routeEngineError => '路線計算失敗，請稍後再試',
      _ => '路線計算失敗，請稍後再試',
    },
    FormatException() => '路線資料格式錯誤，未顯示路線',
    _ => '路線計算失敗，請稍後再試',
  };

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
              ),
        ),
  );

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

  void _openCrowdReport() {
    _reportAddressSearchDebounce?.cancel();
    _reportAddressController.clear();
    setState(() {
      _selectedFeature = null;
      _selectedEvent = null;
      _reportDraft = const CrowdReportDraft(
        category: CrowdReportCategory.roadBlockage,
        location: null,
        locationSource: null,
        description: '',
      );
      _reportStep = CrowdReportSheetStep.edit;
      _reportSheetVisible = true;
      _reportPicking = false;
    });
  }

  void _closeCrowdReport() {
    if (_reportSubmitting) return;
    _reportAddressSearchDebounce?.cancel();
    setState(() {
      _reportDraft = null;
      _reportSheetVisible = false;
      _reportPicking = false;
      _reportStep = CrowdReportSheetStep.edit;
    });
    _reportAddressController.clear();
  }

  Future<void> _setReportCurrentLocation() async {
    final location = await _locationController.requestCurrentLocation();
    if (!mounted) return;
    if (location == null) {
      _showMessage('無法取得目前位置，請開啟瀏覽器或裝置定位權限');
      return;
    }
    final draft = _reportDraft;
    if (draft == null) return;
    setState(() {
      _runtimeState = _runtimeState.copyWith(currentLocation: location);
      _reportDraft = draft.copyWith(
        location: location,
        locationSource: CrowdReportLocationSource.currentLocation,
        locationHint: null,
      );
    });
  }

  void _beginReportMapPick() {
    if (_reportDraft == null || _reportSubmitting) return;
    setState(() {
      _reportSheetVisible = false;
      _reportPicking = true;
      _selectedFeature = null;
      _selectedEvent = null;
    });
  }

  void _returnToReportForm() {
    if (_reportDraft == null || _reportSubmitting) return;
    setState(() {
      _reportPicking = false;
      _reportSheetVisible = true;
    });
  }

  void _confirmReportMapLocation() {
    final draft = _reportDraft;
    if (draft == null || draft.location == null) {
      _showMessage('請先讓中心圖釘取得地圖位置');
      return;
    }
    setState(() {
      _reportPicking = false;
      _reportSheetVisible = true;
    });
  }

  void _onReportCameraSettled(GeoPoint point) {
    final draft = _reportDraft;
    if (!mounted || draft == null) return;
    setState(() {
      _reportDraft = draft.copyWith(
        location: point,
        locationSource: CrowdReportLocationSource.mapPick,
      );
    });
  }

  void _onReportAddressChanged(String value) {
    if (!mounted) return;
    _reportAddressSearchDebounce?.cancel();
    if (value.trim().isEmpty) {
      setState(() {});
      return;
    }
    _reportAddressSearchDebounce = Timer(const Duration(milliseconds: 180), () {
      if (!mounted) return;
      setState(() {});
    });
  }

  void _onReportAddressSelected(MapSearchResult result) {
    final draft = _reportDraft;
    if (draft == null || _reportSubmitting) return;
    _reportAddressSearchDebounce?.cancel();
    final query = _reportAddressController.text.trim();
    final hint = _locationHintFor(result, query);
    _reportAddressController.text = result.displayTitle;
    _reportAddressController.selection = TextSelection.collapsed(
      offset: _reportAddressController.text.length,
    );
    setState(() {
      _reportDraft = draft.copyWith(
        location: result.coordinate,
        locationSource: CrowdReportLocationSource.mapPick,
        locationHint: hint,
      );
      _focusPoint = result.coordinate;
      _focusRequestId += 1;
      _searchSelection = result;
      _reportSheetVisible = false;
      _reportPicking = true;
      _selectedFeature = null;
      _selectedEvent = null;
    });
  }

  CrowdReportLocationHint _locationHintFor(
    MapSearchResult result,
    String query,
  ) {
    final kind = result.searchKind ?? result.feature?.kind;
    final hintKind = switch (kind) {
      'county' => CrowdReportLocationHintKind.county,
      'subdivision' ||
      'district' ||
      'town' => CrowdReportLocationHintKind.district,
      'village' => CrowdReportLocationHintKind.village,
      'road' => CrowdReportLocationHintKind.road,
      _ => CrowdReportLocationHintKind.facility,
    };
    final precision = switch (hintKind) {
      CrowdReportLocationHintKind.county ||
      CrowdReportLocationHintKind.district ||
      CrowdReportLocationHintKind.village => CrowdReportLocationPrecision.area,
      CrowdReportLocationHintKind.road => CrowdReportLocationPrecision.road,
      CrowdReportLocationHintKind.facility =>
        CrowdReportLocationPrecision.point,
    };
    return CrowdReportLocationHint(
      query: query,
      label: result.displayTitle,
      kind: hintKind,
      precision: precision,
    );
  }

  void _showReportConfirmation() {
    final draft = _reportDraft;
    if (draft == null) return;
    final error = draft.validate();
    if (error != null) {
      _showMessage(error);
      return;
    }
    setState(() => _reportStep = CrowdReportSheetStep.confirm);
  }

  Future<void> _submitCrowdReport() async {
    final draft = _reportDraft;
    if (draft == null || _reportSubmitting) return;
    final validationError = draft.validate();
    if (validationError != null) {
      _showMessage(validationError);
      return;
    }
    setState(() => _reportSubmitting = true);
    try {
      final submission = await _bridge.submitCrowdReport(draft);
      if (!mounted) return;
      setState(() {
        _reportSubmitting = false;
        _reportDeliveryEventId = submission.eventId;
        _reportDraft = null;
        _reportSheetVisible = false;
        _reportStep = CrowdReportSheetStep.edit;
      });
      _showMessage('告警已建立：未驗證／待同步');
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _reportSubmitting = false);
      _showMessage(_reportErrorMessage(error));
    }
  }

  String _reportErrorMessage(Object error) => switch (error) {
    BridgeFailure(:final code) => switch (code) {
      BridgeFailureCode.unavailable => '此功能需要 Android App，Chrome 僅供地圖與資料預覽',
      BridgeFailureCode.signingUnavailable => '裝置安全簽署不可用，告警未送出',
      BridgeFailureCode.storageUnavailable => '告警無法儲存至待同步佇列，未送出',
      BridgeFailureCode.invalidInput => '告警資料無效，未送出',
      _ => '告警未送出，請稍後再試',
    },
    FormatException() => '告警資料格式錯誤，未送出',
    _ => '告警未送出，請稍後再試',
  };

  void _setZoomPercentage(int percentage) => setState(() {
    _runtimeState = _runtimeState.copyWith(zoomPercentage: percentage);
  });

  void _selectSearchResult(MapSearchResult result) {
    _mapSearchDebounce?.cancel();
    setState(() {
      _searchSelection = result;
      _focusPoint = result.coordinate;
      _selectedFeature = result.feature;
      _selectedEvent = null;
      _searchText = '';
      _searchController.clear();
      _focusRequestId += 1;
    });
  }

  void _onMapSearchChanged(String value) {
    _mapSearchDebounce?.cancel();
    if (value.trim().isEmpty) {
      if (_searchText.isEmpty) return;
      setState(() => _searchText = '');
      return;
    }
    _mapSearchDebounce = Timer(const Duration(milliseconds: 180), () {
      if (!mounted) return;
      setState(() => _searchText = value);
    });
  }

  Future<void> _focusCurrentLocation() async {
    final location = await _locationController.requestCurrentLocation();
    if (!mounted) return;
    if (location == null) {
      _showMessage('無法取得目前位置，請開啟瀏覽器或裝置定位權限');
      return;
    }
    setState(() {
      _runtimeState = _runtimeState.copyWith(currentLocation: location);
      _focusPoint = location;
      _searchSelection = null;
      _focusRequestId += 1;
    });
  }

  @override
  Widget build(BuildContext context) {
    final staticFeatures = _staticFeatures;
    if (staticFeatures == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final searchIndex = _searchIndex;
    final searchResults =
        searchIndex?.query(_searchText) ?? const <MapSearchResult>[];
    final reportAddressQuery =
        _reportSheetVisible && _reportStep == CrowdReportSheetStep.edit
            ? _reportAddressController.text
            : '';
    final reportAddressResults =
        searchIndex?.query(reportAddressQuery) ?? const <MapSearchResult>[];
    return Scaffold(
      body: Stack(
        children: <Widget>[
          MapCanvas(
            runtimeState: _runtimeState,
            staticFeatures: staticFeatures.features,
            administrativeIndex: _administrativeIndex,
            visibleEvents: _visibleEvents,
            showShelters: _showShelters,
            showMedical: _showMedical,
            showEvents: _showEvents,
            onStaticFeatureSelected: _showStaticSelection,
            onEventSelected: _showEvent,
            onZoomPercentageChanged: _setZoomPercentage,
            onOpenLayerSettings: _openLayerPanel,
            onRequestLocation: _focusCurrentLocation,
            onMapTap: _closeDetails,
            onReportCameraIdle: _reportPicking ? _onReportCameraSettled : null,
            showReportLocationPicker: _reportPicking,
            route: _routeResult,
            searchSelection: _searchSelection,
            focusPoint: _focusPoint,
            focusRequestId: _focusRequestId,
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  PointerInterceptor(
                    child: _SearchOverlay(
                      text: _searchText,
                      controller: _searchController,
                      results: searchResults,
                      onChanged: _onMapSearchChanged,
                      onSelected: _selectSearchResult,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Flexible(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 520),
                          child: _StatusOverlay(
                            snapshotAt: staticFeatures.snapshotAt,
                            hasCurrentLocation:
                                _runtimeState.currentLocation != null,
                            reportDeliveryEventId: _reportDeliveryEventId,
                            staticFeaturesPending: widget.staticFeaturesPending,
                            staticFeaturesFailed: widget.staticFeaturesFailed,
                          ),
                        ),
                      ),
                      const Spacer(),
                      _MapQuickActions(
                        onReport:
                            _reportSheetVisible ||
                                    _reportPicking ||
                                    _routeSheetVisible
                                ? null
                                : _openCrowdReport,
                        onRecommend:
                            _reportSheetVisible ||
                                    _reportPicking ||
                                    _routeSheetVisible
                                ? null
                                : _recommendNearestShelter,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_reportPicking)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Card(
                        child: Padding(
                          padding: EdgeInsets.all(10),
                          child: Text('請拖動地圖，讓中心圖釘對準告警位置'),
                        ),
                      ),
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
                onPlanEvacuationRoute:
                    _selectedFeature!.kind == 'shelter'
                        ? () => _calculateRouteTo(_selectedFeature!)
                        : null,
              ),
            ),
          if (_selectedEvent != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: FeatureDetailsSheet.event(
                event: _selectedEvent!,
                corroboration: _corroborationOf(_selectedEvent!),
                onClose: _closeDetails,
              ),
            ),
          if (_reportSheetVisible && _reportDraft != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: CrowdReportSheet(
                draft: _reportDraft!,
                step: _reportStep,
                submitting: _reportSubmitting,
                onDraftChanged: (draft) => setState(() => _reportDraft = draft),
                onRequestCurrentLocation: _setReportCurrentLocation,
                onRequestMapPick: _beginReportMapPick,
                addressController: _reportAddressController,
                addressResults:
                    _reportAddressController.text.trim().isEmpty
                        ? const <MapSearchResult>[]
                        : reportAddressResults,
                onAddressChanged: _onReportAddressChanged,
                onAddressSelected: _onReportAddressSelected,
                onShowConfirmation: _showReportConfirmation,
                onBackToEdit:
                    () =>
                        setState(() => _reportStep = CrowdReportSheetStep.edit),
                onSubmit: _submitCrowdReport,
                onCancel: _closeCrowdReport,
              ),
            ),
          if (_reportPicking && _reportDraft != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: CrowdReportMapPickerBar(
                draft: _reportDraft!,
                onBackToForm: _returnToReportForm,
                onConfirm: _confirmReportMapLocation,
              ),
            ),
          if (_routeSheetVisible)
            Align(
              alignment: Alignment.bottomCenter,
              child: EvacuationRouteSheet(
                route: _routeResult,
                loading: _routeLoading,
                errorMessage: _routeErrorMessage,
                stale: _routeStale,
                loadingMessage: _routeLoadingMessage,
                onRecalculate:
                    _routeDestination == null
                        ? null
                        : () => _calculateRouteTo(_routeDestination!),
                onClose: _closeRoute,
              ),
            ),
        ],
      ),
    );
  }
}

class _StatusOverlay extends StatelessWidget {
  const _StatusOverlay({
    required this.snapshotAt,
    required this.hasCurrentLocation,
    required this.reportDeliveryEventId,
    this.staticFeaturesPending = false,
    this.staticFeaturesFailed = false,
  });

  final String? snapshotAt;
  final bool hasCurrentLocation;
  final String? reportDeliveryEventId;
  final bool staticFeaturesPending;
  final bool staticFeaturesFailed;

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
          SizedBox(
            width: double.infinity,
            child: FittedBox(
              alignment: Alignment.centerLeft,
              fit: BoxFit.scaleDown,
              child: Text(
                '更新時間：${formatUpdateTime(snapshotAt)}',
                maxLines: 1,
                softWrap: false,
              ),
            ),
          ),
          Text('目前位置：${hasCurrentLocation ? '已取得' : '尚未取得'}'),
          if (staticFeaturesPending)
            const Text(
              '避難所資料驗證中…',
              key: ValueKey<String>('static-features-pending'),
            ),
          if (staticFeaturesFailed)
            const Text(
              '避難所資料驗證失敗，未顯示',
              key: ValueKey<String>('static-features-failed'),
            ),
          if (reportDeliveryEventId != null) ...<Widget>[
            const Text('民眾告警：未驗證／待同步'),
            Text('告警編號：$reportDeliveryEventId'),
          ],
        ],
      ),
    ),
  );
}

class _MapQuickActions extends StatelessWidget {
  const _MapQuickActions({this.onReport, this.onRecommend});

  final VoidCallback? onReport;
  final VoidCallback? onRecommend;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      _QuickActionButton(
        key: const ValueKey<String>('open-crowd-report-action'),
        label: '回報告警',
        icon: Icons.warning_amber_rounded,
        onPressed: onReport,
        buttonKey: const ValueKey<String>('open-crowd-report'),
      ),
      const SizedBox(width: 8),
      _QuickActionButton(
        key: const ValueKey<String>('recommend-nearest-shelter-action'),
        label: '推薦最近避難所',
        icon: MapIconCatalog.shelterRecommendation,
        onPressed: onRecommend,
        buttonKey: const ValueKey<String>('recommend-nearest-shelter'),
      ),
    ],
  );
}

class _QuickActionButton extends StatelessWidget {
  const _QuickActionButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    required this.buttonKey,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final Key buttonKey;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    button: true,
    label: label,
    onTap: onPressed,
    child: ExcludeSemantics(
      child: Material(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.94),
        elevation: 4,
        borderRadius: BorderRadius.circular(14),
        child: IconButton(
          key: buttonKey,
          tooltip: label,
          onPressed: onPressed,
          icon: Icon(icon),
        ),
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
                        final address =
                            result.address ??
                            result.feature?.details['address'];
                        final location = result.region;
                        final subtitle = <String>[
                          result.typeLabel,
                          if (location != null && location.isNotEmpty) location,
                          if (address is String && address.isNotEmpty) address,
                        ].join('・');
                        return ListTile(
                          dense: true,
                          title: Text(result.displayTitle),
                          subtitle: Text(subtitle),
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

const EvacuationRouteResult _invalidRouteResult = EvacuationRouteResult(
  status: EvacuationRouteStatus.invalidInput,
  polyline: <GeoPoint>[],
  distanceM: null,
  durationS: null,
  graphVersion: null,
  eventSnapshotAt: null,
  warnings: <RouteWarning>[],
  blockedEventIds: <String>[],
);

const EvacuationRouteResult _noRouteResult = EvacuationRouteResult(
  status: EvacuationRouteStatus.noRoute,
  polyline: <GeoPoint>[],
  distanceM: null,
  durationS: null,
  graphVersion: null,
  eventSnapshotAt: null,
  warnings: <RouteWarning>[],
  blockedEventIds: <String>[],
);

String _eventFingerprint(Iterable<MeshEvent> events) {
  final identities = events.map(meshEventIdentity).toList(growable: false)
    ..sort();
  return jsonEncode(identities);
}
