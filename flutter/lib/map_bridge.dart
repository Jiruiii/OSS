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
    final response = await _invokeMap('getInitialState');
    return MapInitialState.fromJson(response);
  }

  Future<FixtureLoadSummary> loadBundledFixture() async {
    final response = await _invokeMap('loadBundledFixture');
    return FixtureLoadSummary.fromJson(response);
  }

  Future<bool> setEmergencyMode({required bool enabled}) async {
    final response = await _invokeMap('setEmergencyMode', <String, dynamic>{
      'enabled': enabled,
    });
    return response['enabled'] is bool ? response['enabled'] as bool : false;
  }

  Stream<List<MeshEvent>> get events => _eventChannel
      .receiveBroadcastStream()
      .map<List<MeshEvent>>(eventsFromMessage);

  Future<Map<String, dynamic>> _invokeMap(
    String method, [
    Map<String, dynamic>? arguments,
  ]) async {
    final response = await _methodChannel.invokeMethod<Object?>(
      method,
      arguments,
    );
    return mapFromMessage(response) ?? const <String, dynamic>{};
  }
}
