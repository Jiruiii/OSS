import 'package:flutter/material.dart';

import 'map_models.dart';

enum MapProviderMode { googleOnline, offline }

/// UI-only map state shared by the online and offline renderers.
///
/// Persisted events and occupancy remain owned by the Android bridge/Room.
class MapRuntimeState {
  const MapRuntimeState({
    required this.providerMode,
    required this.themeMode,
    required this.zoomPercentage,
    required this.currentLocation,
    required this.animationEnabled,
  }) : assert(zoomPercentage >= 0 && zoomPercentage <= 100);

  final MapProviderMode providerMode;
  final ThemeMode themeMode;
  final int zoomPercentage;
  final GeoPoint? currentLocation;
  final bool animationEnabled;

  MapRuntimeState copyWith({
    MapProviderMode? providerMode,
    ThemeMode? themeMode,
    int? zoomPercentage,
    Object? currentLocation = _unchangedLocation,
    bool? animationEnabled,
  }) => MapRuntimeState(
    providerMode: providerMode ?? this.providerMode,
    themeMode: themeMode ?? this.themeMode,
    zoomPercentage: zoomPercentage ?? this.zoomPercentage,
    currentLocation:
        identical(currentLocation, _unchangedLocation)
            ? this.currentLocation
            : currentLocation as GeoPoint?,
    animationEnabled: animationEnabled ?? this.animationEnabled,
  );
}

const Object _unchangedLocation = Object();
