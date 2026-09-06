import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'map_models.dart';

/// Injectable boundary around the platform location plugin.
abstract interface class LocationGateway {
  Future<bool> isServiceEnabled();

  Future<LocationPermission> checkPermission();

  Future<LocationPermission> requestPermission();

  Future<GeoPoint?> getCurrentLocation();

  Stream<GeoPoint> get locationUpdates;
}

class GeolocatorLocationGateway implements LocationGateway {
  const GeolocatorLocationGateway();

  @override
  Future<LocationPermission> checkPermission() => Geolocator.checkPermission();

  @override
  Future<GeoPoint?> getCurrentLocation() async {
    final position = await Geolocator.getCurrentPosition();
    return _toGeoPoint(position);
  }

  @override
  Future<bool> isServiceEnabled() => Geolocator.isLocationServiceEnabled();

  @override
  Stream<GeoPoint> get locationUpdates =>
      Geolocator.getPositionStream().map(_toGeoPoint);

  @override
  Future<LocationPermission> requestPermission() =>
      Geolocator.requestPermission();
}

/// Requests device location only in response to an explicit user action.
class LocationController {
  LocationController({LocationGateway? gateway})
    : _gateway = gateway ?? const GeolocatorLocationGateway();

  final LocationGateway _gateway;
  final StreamController<GeoPoint> _locations =
      StreamController<GeoPoint>.broadcast();
  StreamSubscription<GeoPoint>? _locationSubscription;
  bool _disposed = false;

  Stream<GeoPoint> get locations => _locations.stream;

  Future<GeoPoint?> requestCurrentLocation() async {
    if (_disposed) return null;

    try {
      if (!await _gateway.isServiceEnabled()) return null;

      var permission = await _gateway.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await _gateway.requestPermission();
      }
      if (!_isGranted(permission)) return null;

      final location = await _gateway.getCurrentLocation();
      if (location == null) return null;
      _listenForUpdates();
      return location;
    } on Object {
      return null;
    }
  }

  void _listenForUpdates() {
    if (_locationSubscription != null || _disposed) return;
    _locationSubscription = _gateway.locationUpdates.listen(
      _locations.add,
      onError: (_) {},
    );
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _locationSubscription?.cancel();
    await _locations.close();
  }
}

bool _isGranted(LocationPermission permission) =>
    permission == LocationPermission.whileInUse ||
    permission == LocationPermission.always;

GeoPoint _toGeoPoint(Position position) =>
    GeoPoint(longitude: position.longitude, latitude: position.latitude);
