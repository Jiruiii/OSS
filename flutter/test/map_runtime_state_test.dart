import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:resilientgeo_flutter/data/location_controller.dart';
import 'package:resilientgeo_flutter/data/map_models.dart';
import 'package:resilientgeo_flutter/data/map_runtime_state.dart';

void main() {
  group('MapRuntimeState', () {
    test('holds presentation state without inventing a current location', () {
      const state = MapRuntimeState(
        providerMode: MapProviderMode.offline,
        themeMode: ThemeMode.system,
        zoomPercentage: 0,
        currentLocation: null,
        animationEnabled: true,
      );

      expect(state.providerMode, MapProviderMode.offline);
      expect(state.themeMode, ThemeMode.system);
      expect(state.zoomPercentage, 0);
      expect(state.currentLocation, isNull);
      expect(state.animationEnabled, isTrue);
    });

    test('copyWith changes only the requested presentation values', () {
      const location = GeoPoint(longitude: 121.5908, latitude: 25.0609);
      const state = MapRuntimeState(
        providerMode: MapProviderMode.offline,
        themeMode: ThemeMode.light,
        zoomPercentage: 25,
        currentLocation: location,
        animationEnabled: true,
      );

      final updated = state.copyWith(
        providerMode: MapProviderMode.googleOnline,
        themeMode: ThemeMode.dark,
        zoomPercentage: 75,
        animationEnabled: false,
      );

      expect(updated.providerMode, MapProviderMode.googleOnline);
      expect(updated.themeMode, ThemeMode.dark);
      expect(updated.zoomPercentage, 75);
      expect(updated.currentLocation, same(location));
      expect(updated.animationEnabled, isFalse);
      expect(updated.copyWith(currentLocation: null).currentLocation, isNull);
    });
  });

  group('LocationController', () {
    test('does not inspect or request permission during construction', () {
      final gateway = _FakeLocationGateway();

      final controller = LocationController(gateway: gateway);
      addTearDown(controller.dispose);

      expect(gateway.serviceChecks, 0);
      expect(gateway.permissionChecks, 0);
      expect(gateway.permissionRequests, 0);
      expect(gateway.currentLocationRequests, 0);
    });

    test(
      'returns null without requesting permission when service is off',
      () async {
        final gateway = _FakeLocationGateway(serviceEnabled: false);
        final controller = LocationController(gateway: gateway);
        addTearDown(controller.dispose);

        final result = await controller.requestCurrentLocation();

        expect(result, isNull);
        expect(gateway.serviceChecks, 1);
        expect(gateway.permissionChecks, 0);
        expect(gateway.permissionRequests, 0);
        expect(gateway.currentLocationRequests, 0);
      },
    );

    test(
      'returns null when the explicit permission request is denied',
      () async {
        final gateway = _FakeLocationGateway(
          checkedPermission: LocationPermission.denied,
          requestedPermission: LocationPermission.deniedForever,
        );
        final controller = LocationController(gateway: gateway);
        addTearDown(controller.dispose);

        final result = await controller.requestCurrentLocation();

        expect(result, isNull);
        expect(gateway.permissionChecks, 1);
        expect(gateway.permissionRequests, 1);
        expect(gateway.currentLocationRequests, 0);
      },
    );

    test('returns granted location and forwards later updates', () async {
      const current = GeoPoint(longitude: 121.5908, latitude: 25.0609);
      const update = GeoPoint(longitude: 121.5912, latitude: 25.0612);
      final gateway = _FakeLocationGateway(
        checkedPermission: LocationPermission.whileInUse,
        currentLocation: current,
      );
      final controller = LocationController(gateway: gateway);
      addTearDown(controller.dispose);

      final updateExpectation = expectLater(
        controller.locations,
        emitsInOrder(<Object>[same(update)]),
      );
      final result = await controller.requestCurrentLocation();
      gateway.emit(update);

      expect(result, same(current));
      expect(gateway.permissionRequests, 0);
      expect(gateway.currentLocationRequests, 1);
      await updateExpectation;
    });

    test('turns location platform failures into unavailable null', () async {
      final gateway = _FakeLocationGateway(
        checkedPermission: LocationPermission.always,
        currentLocationError: const LocationServiceDisabledException(),
      );
      final controller = LocationController(gateway: gateway);
      addTearDown(controller.dispose);

      expect(await controller.requestCurrentLocation(), isNull);
    });
  });
}

class _FakeLocationGateway implements LocationGateway {
  _FakeLocationGateway({
    this.serviceEnabled = true,
    this.checkedPermission = LocationPermission.denied,
    this.requestedPermission = LocationPermission.whileInUse,
    this.currentLocation,
    this.currentLocationError,
  });

  final bool serviceEnabled;
  final LocationPermission checkedPermission;
  final LocationPermission requestedPermission;
  final GeoPoint? currentLocation;
  final Object? currentLocationError;
  final StreamController<GeoPoint> _updates = StreamController.broadcast();

  int serviceChecks = 0;
  int permissionChecks = 0;
  int permissionRequests = 0;
  int currentLocationRequests = 0;

  @override
  Future<LocationPermission> checkPermission() async {
    permissionChecks += 1;
    return checkedPermission;
  }

  @override
  Future<GeoPoint?> getCurrentLocation() async {
    currentLocationRequests += 1;
    if (currentLocationError case final error?) throw error;
    return currentLocation;
  }

  @override
  Future<bool> isServiceEnabled() async {
    serviceChecks += 1;
    return serviceEnabled;
  }

  @override
  Stream<GeoPoint> get locationUpdates => _updates.stream;

  @override
  Future<LocationPermission> requestPermission() async {
    permissionRequests += 1;
    return requestedPermission;
  }

  void emit(GeoPoint point) => _updates.add(point);
}
