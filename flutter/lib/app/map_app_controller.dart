import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/map_bridge.dart';
import '../data/map_models.dart';

/// App-level presentation coordinator.
///
/// Android remains the owner of Room and event writes. This controller only
/// reads the verified event stream once and fans it out to the map and the
/// notifications tab.
class MapAppController extends ChangeNotifier {
  MapAppController({MapBridge? bridge}) : bridge = bridge ?? MapBridge();

  static const _themePreference = 'map.theme_mode';
  static const _animationPreference = 'map.animation_enabled';

  final MapBridge bridge;
  final Connectivity _connectivity = Connectivity();
  final StreamController<List<MeshEvent>> _eventUpdates =
      StreamController<List<MeshEvent>>.broadcast();

  StreamSubscription<List<MeshEvent>>? _eventSubscription;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  StaticFeatureCollection? staticFeatures;
  List<MeshEvent> demoEvents = const <MeshEvent>[];
  List<MeshEvent> persistedEvents = const <MeshEvent>[];
  MapInitialState initialState = const MapInitialState(
    events: <MeshEvent>[],
    emergencyModeEnabled: false,
  );
  ThemeMode themeMode = ThemeMode.system;
  bool animationEnabled = true;
  bool networkAvailable = false;
  bool googleMapsConfigured = false;
  bool nativeBridgeAvailable = false;
  bool isLoading = true;
  Object? loadError;
  bool _disposed = false;

  Stream<List<MeshEvent>> get eventUpdates => _eventUpdates.stream;

  String? get snapshotAt => staticFeatures?.snapshotAt;

  List<MeshEvent> get events {
    final byId = <String, MeshEvent>{};
    for (final event in demoEvents) {
      byId[event.eventId ?? 'demo-${byId.length}'] = event;
    }
    for (final event in persistedEvents) {
      byId[event.eventId ?? 'persisted-${byId.length}'] = event;
    }
    return byId.values.toList(growable: false);
  }

  int get notificationCount => events.where((event) => !event.isExpired).length;

  Future<void> load() async {
    try {
      final rawStatic = await rootBundle.loadString(
        'assets/data/neihu/static-features.json',
      );
      staticFeatures = StaticFeatureCollection.fromJson(
        Map<String, dynamic>.from(jsonDecode(rawStatic) as Map),
      );

      final rawDemo = await rootBundle.loadString(
        'assets/data/neihu/demo-events.json',
      );
      demoEvents = eventsFromMessage(
        (jsonDecode(rawDemo) as Map<String, dynamic>)['events'],
      );

      try {
        initialState = await bridge.getInitialState();
        persistedEvents = initialState.events;
        nativeBridgeAvailable = true;
      } on Object {
        // Preview builds without the Android host still show the bundled map.
        initialState = const MapInitialState(
          events: <MeshEvent>[],
          emergencyModeEnabled: false,
        );
      }

      if (nativeBridgeAvailable) {
        googleMapsConfigured = await bridge.hasGoogleMapsApiKey();
      }

      await _loadPreferences();
      await _loadConnectivity();
      if (nativeBridgeAvailable) _listenToNativeEvents();
    } on Object catch (error) {
      loadError = error;
    } finally {
      isLoading = false;
      _notifyIfAlive();
    }
  }

  Future<void> _loadPreferences() async {
    final preferences = await SharedPreferences.getInstance();
    themeMode = _themeModeFromName(preferences.getString(_themePreference));
    animationEnabled = preferences.getBool(_animationPreference) ?? true;
  }

  Future<void> _loadConnectivity() async {
    try {
      final result = await _connectivity.checkConnectivity();
      networkAvailable = _hasNetwork(result);
      _connectivitySubscription = _connectivity.onConnectivityChanged.listen(
        (results) {
          final next = _hasNetwork(results);
          if (next == networkAvailable) return;
          networkAvailable = next;
          _notifyIfAlive();
        },
        onError: (_) {},
      );
    } on Object {
      networkAvailable = false;
    }
  }

  void _listenToNativeEvents() {
    _eventSubscription = bridge.events.listen(
      (events) {
        if (_disposed) return;
        persistedEvents = events;
        _eventUpdates.add(List<MeshEvent>.unmodifiable(events));
        _notifyIfAlive();
      },
      onError: (_) {},
    );
  }

  Future<void> setThemeMode(ThemeMode value) async {
    themeMode = value;
    _notifyIfAlive();
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_themePreference, value.name);
  }

  Future<void> setAnimationEnabled(bool value) async {
    animationEnabled = value;
    _notifyIfAlive();
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool(_animationPreference, value);
  }

  @override
  void dispose() {
    _disposed = true;
    _eventSubscription?.cancel();
    _connectivitySubscription?.cancel();
    _eventUpdates.close();
    super.dispose();
  }

  void _notifyIfAlive() {
    if (!_disposed) notifyListeners();
  }
}

bool _hasNetwork(List<ConnectivityResult> results) =>
    results.any((result) => result != ConnectivityResult.none);

ThemeMode _themeModeFromName(String? value) => switch (value) {
  'light' => ThemeMode.light,
  'dark' => ThemeMode.dark,
  _ => ThemeMode.system,
};
