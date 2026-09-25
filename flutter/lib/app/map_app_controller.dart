import 'dart:async';
import 'dart:convert';

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
  static const _readEventKeysPreference = 'map.read_event_keys';

  final MapBridge bridge;
  final StreamController<List<MeshEvent>> _eventUpdates =
      StreamController<List<MeshEvent>>.broadcast();

  StreamSubscription<List<MeshEvent>>? _eventSubscription;
  final Set<String> _readEventKeys = <String>{};
  StaticFeatureCollection? staticFeatures;
  List<MeshEvent> persistedEvents = const <MeshEvent>[];
  MapInitialState initialState = const MapInitialState(
    events: <MeshEvent>[],
    emergencyModeEnabled: false,
  );
  ThemeMode themeMode = ThemeMode.system;
  bool animationEnabled = true;
  bool nativeBridgeAvailable = false;
  bool isLoading = true;
  Object? loadError;
  bool _disposed = false;

  Stream<List<MeshEvent>> get eventUpdates => _eventUpdates.stream;

  String? get snapshotAt => staticFeatures?.snapshotAt;

  List<MeshEvent> get events {
    final byId = <String, MeshEvent>{};
    for (final event in persistedEvents) {
      byId[meshEventIdentity(event)] = event;
    }
    return byId.values.toList(growable: false);
  }

  List<MeshEvent> get unreadEvents => events
      .where((event) => !_readEventKeys.contains(meshEventIdentity(event)))
      .toList(growable: false);

  int get notificationCount => unreadEvents.length;

  Future<void> load() async {
    try {
      final rawStatic = await rootBundle.loadString(
        'assets/data/neihu/static-features.json',
      );
      staticFeatures = StaticFeatureCollection.fromJson(
        Map<String, dynamic>.from(jsonDecode(rawStatic) as Map),
      );

      try {
        final loadedState = await bridge.getInitialState();
        final verifiedEvents = _withoutDemoEvents(loadedState.events);
        initialState = MapInitialState(
          events: verifiedEvents,
          emergencyModeEnabled: loadedState.emergencyModeEnabled,
        );
        persistedEvents = verifiedEvents;
        nativeBridgeAvailable = true;
      } on Object {
        // Preview builds without the Android host still show the bundled map.
        initialState = const MapInitialState(
          events: <MeshEvent>[],
          emergencyModeEnabled: false,
        );
      }

      await _loadPreferences();
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
    _readEventKeys
      ..clear()
      ..addAll(
        preferences.getStringList(_readEventKeysPreference) ?? const <String>[],
      );
  }

  void _listenToNativeEvents() {
    _eventSubscription = bridge.events.listen((events) {
      if (_disposed) return;
      final verifiedEvents = _withoutDemoEvents(events);
      persistedEvents = verifiedEvents;
      _eventUpdates.add(List<MeshEvent>.unmodifiable(verifiedEvents));
      _notifyIfAlive();
    }, onError: (_) {});
  }

  Future<void> markEventRead(MeshEvent event) async {
    final key = meshEventIdentity(event);
    if (!_readEventKeys.add(key)) return;
    _notifyIfAlive();
    final preferences = await SharedPreferences.getInstance();
    final sortedKeys = _readEventKeys.toList()..sort();
    await preferences.setStringList(_readEventKeysPreference, sortedKeys);
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
    _eventUpdates.close();
    super.dispose();
  }

  void _notifyIfAlive() {
    if (!_disposed) notifyListeners();
  }
}

List<MeshEvent> _withoutDemoEvents(Iterable<MeshEvent> events) =>
    List<MeshEvent>.unmodifiable(events.where((event) => !_isDemoEvent(event)));

bool _isDemoEvent(MeshEvent event) =>
    event.namespace?.startsWith('demo.') == true ||
    event.eventId?.startsWith('demo:') == true ||
    event.attributes?['is_demo'] == true;

ThemeMode _themeModeFromName(String? value) => switch (value) {
  'light' => ThemeMode.light,
  'dark' => ThemeMode.dark,
  _ => ThemeMode.system,
};
