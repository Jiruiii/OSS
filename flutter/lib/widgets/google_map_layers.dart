import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as google;

import '../data/map_models.dart';
import 'map_layers.dart';

/// Google Maps equivalents of the shared asset-map overlays.
///
/// The data source stays identical to [MapLayers]: this class only translates
/// it into the Android/iOS Google Maps SDK objects.
class GoogleMapLayers {
  const GoogleMapLayers._();

  static const double markerDiameter = 30;

  static GoogleMapOverlays build({
    required List<StaticFeature> features,
    required List<MeshEvent> events,
    required bool showShelters,
    required bool showMedical,
    required bool showEvents,
    required StaticFeatureSelection onStaticFeatureSelected,
    required MeshEventSelection onEventSelected,
    required Set<String> pulsingEventKeys,
    required double pulseFraction,
    GoogleMarkerIcons? markerIcons,
  }) {
    final visibleFacilities = features
        .where((feature) {
          return (showShelters && feature.kind == 'shelter') ||
              (showMedical && feature.kind == 'medical');
        })
        .toList(growable: false);
    final visibleEvents =
        showEvents
            ? events
                .where((event) => event.geometry != null)
                .toList(growable: false)
            : const <MeshEvent>[];

    return GoogleMapOverlays(
      markers: <google.Marker>{
        ..._facilityMarkers(
          visibleFacilities,
          onStaticFeatureSelected,
          markerIcons,
        ),
        ...visibleEvents.map(
          (event) => _eventMarker(event, onEventSelected, markerIcons),
        ),
      },
      polylines:
          visibleEvents
              .where((event) => event.geometry is LineStringGeometry)
              .map((event) => _eventPolyline(event, onEventSelected))
              .toSet(),
      polygons:
          visibleEvents
              .where((event) => event.geometry is PolygonGeometry)
              .map((event) => _eventPolygon(event, onEventSelected))
              .toSet(),
      circles:
          visibleEvents
              .where((event) => pulsingEventKeys.contains(_eventKey(event)))
              .map((event) => _pulseCircle(event, pulseFraction))
              .toSet(),
    );
  }

  static Set<google.Marker> _facilityMarkers(
    List<StaticFeature> features,
    StaticFeatureSelection onSelected,
    GoogleMarkerIcons? markerIcons,
  ) {
    final grouped = <String, List<StaticFeature>>{};
    for (final feature in features) {
      final geometry = feature.geometry;
      if (geometry is! PointGeometry) continue;
      final point = geometry.point;
      final key = '${point.longitude}:${point.latitude}';
      grouped.putIfAbsent(key, () => <StaticFeature>[]).add(feature);
    }

    return grouped.values.map((group) {
      final first = group.first;
      final point = (first.geometry! as PointGeometry).point;
      final medicalOnly = group.every((feature) => feature.kind == 'medical');
      final title =
          group.length == 1
              ? featureName(first)
              : '重疊地點（${group.map(featureName).join('、')}）';
      return google.Marker(
        markerId: google.MarkerId('facility-${first.id ?? title}'),
        position: _latLng(point),
        icon:
            medicalOnly
                ? (markerIcons?.medical ?? _fallbackMedicalMarker)
                : (markerIcons?.shelter ?? _fallbackShelterMarker),
        infoWindow: google.InfoWindow(title: title),
        consumeTapEvents: true,
        onTap: () => onSelected(group),
      );
    }).toSet();
  }

  static google.Marker _eventMarker(
    MeshEvent event,
    MeshEventSelection onSelected,
    GoogleMarkerIcons? markerIcons,
  ) {
    final name = eventName(event);
    return google.Marker(
      markerId: google.MarkerId('event-${_eventKey(event)}'),
      position: _eventFocus(event),
      icon:
          event.isExpired
              ? (markerIcons?.expiredEvent ?? _fallbackExpiredMarker)
              : (markerIcons?.event ?? _fallbackEventMarker),
      infoWindow: google.InfoWindow(
        title: name,
        snippet: event.isExpired ? '已過期' : event.severity,
      ),
      consumeTapEvents: true,
      onTap: () => onSelected(event),
    );
  }

  static google.Polyline _eventPolyline(
    MeshEvent event,
    MeshEventSelection onSelected,
  ) {
    final geometry = event.geometry! as LineStringGeometry;
    return google.Polyline(
      polylineId: google.PolylineId('event-line-${_eventKey(event)}'),
      points: geometry.points.map(_latLng).toList(growable: false),
      color: eventColor(event),
      width: event.isExpired ? 4 : 6,
      patterns:
          event.isExpired
              ? <google.PatternItem>[
                google.PatternItem.dot,
                google.PatternItem.gap(12),
              ]
              : const <google.PatternItem>[],
      consumeTapEvents: true,
      onTap: () => onSelected(event),
    );
  }

  static google.Polygon _eventPolygon(
    MeshEvent event,
    MeshEventSelection onSelected,
  ) {
    final geometry = event.geometry! as PolygonGeometry;
    return google.Polygon(
      polygonId: google.PolygonId('event-area-${_eventKey(event)}'),
      points: geometry.rings.first.map(_latLng).toList(growable: false),
      holes: geometry.rings
          .skip(1)
          .map((ring) => ring.map(_latLng).toList(growable: false))
          .toList(growable: false),
      fillColor: eventColor(
        event,
      ).withValues(alpha: event.isExpired ? 0.12 : 0.28),
      strokeColor: eventColor(event),
      strokeWidth: 3,
      consumeTapEvents: true,
      onTap: () => onSelected(event),
    );
  }

  static google.Circle _pulseCircle(MeshEvent event, double fraction) {
    final color = eventColor(event);
    return google.Circle(
      circleId: google.CircleId('pulse-${_eventKey(event)}'),
      center: _eventFocus(event),
      radius: 70 + (130 * fraction),
      fillColor: color.withValues(alpha: 0.08),
      strokeColor: color.withValues(alpha: 0.65 - (0.4 * fraction)),
      strokeWidth: 2,
    );
  }

  static google.LatLng _eventFocus(MeshEvent event) {
    final geometry = event.geometry!;
    final point = switch (geometry) {
      PointGeometry(:final point) => point,
      LineStringGeometry(:final points) => points[points.length ~/ 2],
      PolygonGeometry(:final rings) => rings.first.first,
    };
    return _latLng(point);
  }

  static String _eventKey(MeshEvent event) =>
      '${event.eventId ?? 'event'}:${event.eventVersion ?? 0}';

  static google.LatLng _latLng(GeoPoint point) =>
      google.LatLng(point.latitude, point.longitude);

  static final google.BitmapDescriptor _fallbackShelterMarker = google
      .BitmapDescriptor.defaultMarkerWithHue(google.BitmapDescriptor.hueCyan);
  static final google.BitmapDescriptor _fallbackMedicalMarker = google
      .BitmapDescriptor.defaultMarkerWithHue(google.BitmapDescriptor.hueViolet);
  static final google.BitmapDescriptor _fallbackEventMarker = google
      .BitmapDescriptor.defaultMarkerWithHue(google.BitmapDescriptor.hueOrange);
  static final google.BitmapDescriptor _fallbackExpiredMarker = google
      .BitmapDescriptor.defaultMarkerWithHue(google.BitmapDescriptor.hueAzure);
}

class GoogleMapOverlays {
  const GoogleMapOverlays({
    required this.markers,
    required this.polylines,
    required this.polygons,
    required this.circles,
  });

  final Set<google.Marker> markers;
  final Set<google.Polyline> polylines;
  final Set<google.Polygon> polygons;
  final Set<google.Circle> circles;
}

/// Small PNG marker descriptors keep Google and Flutter marker footprints close
/// to 30 logical pixels on phones and high-density screens.
class GoogleMarkerIcons {
  const GoogleMarkerIcons({
    required this.shelter,
    required this.medical,
    required this.event,
    required this.expiredEvent,
  });

  final google.BitmapDescriptor shelter;
  final google.BitmapDescriptor medical;
  final google.BitmapDescriptor event;
  final google.BitmapDescriptor expiredEvent;

  static Future<GoogleMarkerIcons> create({
    required double devicePixelRatio,
  }) async {
    final size = GoogleMapLayers.markerDiameter;
    final icons = await Future.wait<google.BitmapDescriptor>(
      <Future<google.BitmapDescriptor>>[
        _roundIcon(const Color(0xFF006C63), size, devicePixelRatio),
        _roundIcon(const Color(0xFF6A1B9A), size, devicePixelRatio),
        _roundIcon(const Color(0xFFEF6C00), size, devicePixelRatio),
        _roundIcon(Colors.grey.shade700, size, devicePixelRatio),
      ],
    );
    return GoogleMarkerIcons(
      shelter: icons[0],
      medical: icons[1],
      event: icons[2],
      expiredEvent: icons[3],
    );
  }

  static Future<google.BitmapDescriptor> _roundIcon(
    Color color,
    double logicalSize,
    double devicePixelRatio,
  ) async {
    final pixels = (logicalSize * devicePixelRatio).round();
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    final center = ui.Offset(pixels / 2, pixels / 2);
    final radius = pixels / 2;
    canvas.drawCircle(center, radius, ui.Paint()..color = Colors.white);
    canvas.drawCircle(
      center,
      radius - (2 * devicePixelRatio),
      ui.Paint()..color = color,
    );
    final image = await recorder.endRecording().toImage(pixels, pixels);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final bytes = data?.buffer.asUint8List();
    if (bytes == null || bytes.isEmpty) {
      return google.BitmapDescriptor.defaultMarker;
    }
    return google.BitmapDescriptor.bytes(
      Uint8List.fromList(bytes),
      width: logicalSize,
      height: logicalSize,
    );
  }
}
