import 'package:flutter/services.dart';

import 'map_models.dart';

/// Typed, read-only access to Android-owned map state.
class MapBridge {
  MapBridge({MethodChannel? methodChannel, EventChannel? eventChannel})
    : _methodChannel = methodChannel ?? const MethodChannel(methodChannelName),
      _eventChannel = eventChannel ?? const EventChannel(eventChannelName);

  static const methodChannelName = 'com.resilientgeo.mesh/map';
  static const eventChannelName = 'com.resilientgeo.mesh/events';

  final MethodChannel _methodChannel;
  final EventChannel _eventChannel;

  Future<MapInitialState> getInitialState() async {
    final response = await _invokeRequiredMap('getInitialState');
    return MapInitialState.fromJson(response);
  }

  Future<FixtureLoadSummary> loadBundledFixture() async {
    final response = await _invokeRequiredMap('loadBundledFixture');
    return FixtureLoadSummary.fromJson(response);
  }

  Future<bool> setEmergencyMode({required bool enabled}) async {
    final response = await _invokeRequiredMap(
      'setEmergencyMode',
      <String, dynamic>{'enabled': enabled},
    );
    final responseEnabled = response['enabled'];
    if (responseEnabled is! bool) {
      throw const FormatException(
        'setEmergencyMode response is missing boolean enabled',
      );
    }
    return responseEnabled;
  }

  /// Returns whether the Android host has a non-empty Google Maps manifest
  /// key. A Flutter module preview host does not register this channel, so it
  /// safely reports false and keeps using the bundled OSM renderer.
  Future<bool> hasGoogleMapsApiKey() async {
    try {
      return await _methodChannel.invokeMethod<bool>('hasGoogleMapsApiKey') ??
          false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  Stream<List<MeshEvent>> get events => _eventChannel
      .receiveBroadcastStream()
      .map<List<MeshEvent>>(eventsFromMessage);

  Future<Map<String, dynamic>> _invokeRequiredMap(
    String method, [
    Map<String, dynamic>? arguments,
  ]) async {
    final response = await _methodChannel.invokeMethod<Object?>(
      method,
      arguments,
    );
    return requireMapFromMessage(response, '$method response');
  }
}
