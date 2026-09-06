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

  static const double markerDiameter = 32;

  static GoogleMapOverlays build({
    required List<StaticFeature> features,
    required List<MeshEvent> events,
    required bool showShelters,
    required bool showMedical,
    required bool showEvents,
    required StaticFeatureSelection onStaticFeatureSelected,
    required MeshEventSelection onEventSelected,
    GeoPoint? currentLocation,
    GoogleMarkerIcons? markerIcons,
    GeoPoint? radarPoint,
    double radarProgress = 0,
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
                .where((event) => meshEventFocusPoint(event) != null)
                .toList(growable: false)
            : const <MeshEvent>[];

    return GoogleMapOverlays(
      markers: <google.Marker>{
        if (markerIcons != null) ...<google.Marker>{
          ..._facilityMarkers(
            visibleFacilities,
            onStaticFeatureSelected,
            markerIcons,
          ),
          ...visibleEvents.map(
            (event) => _eventMarker(event, onEventSelected, markerIcons),
          ),
        },
        if (currentLocation != null)
          _locationMarker(currentLocation, markerIcons),
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
      circles: _radarCircles(radarPoint, radarProgress),
    );
  }

  static Set<google.Marker> _facilityMarkers(
    List<StaticFeature> features,
    StaticFeatureSelection onSelected,
    GoogleMarkerIcons markerIcons,
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
        icon: medicalOnly ? markerIcons.medical : markerIcons.shelter,
        infoWindow: google.InfoWindow(title: title),
        consumeTapEvents: true,
        onTap: () => onSelected(group),
      );
    }).toSet();
  }

  static google.Marker _eventMarker(
    MeshEvent event,
    MeshEventSelection onSelected,
    GoogleMarkerIcons markerIcons,
  ) {
    final name = eventName(event);
    return google.Marker(
      markerId: google.MarkerId('event-${_eventKey(event)}'),
      position: _eventFocus(event),
      icon: markerIcons.forEvent(event),
      infoWindow: google.InfoWindow(
        title: name,
        snippet: event.isExpired ? '已過期' : event.severity,
      ),
      consumeTapEvents: true,
      onTap: () => onSelected(event),
    );
  }

  static google.Marker _locationMarker(
    GeoPoint location,
    GoogleMarkerIcons? markerIcons,
  ) => google.Marker(
    markerId: const google.MarkerId('demo-current-location'),
    position: _latLng(location),
    icon: markerIcons?.currentLocation ?? _fallbackLocationMarker,
    anchor: const Offset(0.5, 0.5),
    infoWindow: const google.InfoWindow(title: '目前位置'),
    zIndexInt: 1000,
  );

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

  static Set<google.Circle> _radarCircles(GeoPoint? point, double progress) {
    if (point == null) return const <google.Circle>{};
    return <google.Circle>{
      for (var index = 0; index < 3; index += 1)
        google.Circle(
          circleId: google.CircleId('radar-$index'),
          center: _latLng(point),
          radius: 8 + (((progress + (index / 3)) % 1) * 160),
          fillColor: const Color(0xFFD32F2F).withValues(alpha: 0.08),
          strokeColor: const Color(0xFFD32F2F).withValues(alpha: 0.72),
          strokeWidth: 2,
        ),
    };
  }

  static google.LatLng _eventFocus(MeshEvent event) {
    return _latLng(meshEventFocusPoint(event)!);
  }

  static String _eventKey(MeshEvent event) => meshEventIdentity(event);

  static google.LatLng _latLng(GeoPoint point) =>
      google.LatLng(point.latitude, point.longitude);

  static final google.BitmapDescriptor _fallbackLocationMarker =
      google.BitmapDescriptor.defaultMarker;
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
/// to 32 logical pixels on phones and high-density screens.
class GoogleMarkerIcons {
  const GoogleMarkerIcons({
    required this.shelter,
    required this.medical,
    required this.criticalEvent,
    required this.highEvent,
    required this.mediumEvent,
    required this.otherEvent,
    required this.expiredEvent,
    required this.currentLocation,
  });

  final google.BitmapDescriptor shelter;
  final google.BitmapDescriptor medical;
  final google.BitmapDescriptor criticalEvent;
  final google.BitmapDescriptor highEvent;
  final google.BitmapDescriptor mediumEvent;
  final google.BitmapDescriptor otherEvent;
  final google.BitmapDescriptor expiredEvent;
  final google.BitmapDescriptor currentLocation;

  google.BitmapDescriptor forEvent(MeshEvent event) {
    if (event.isExpired) return expiredEvent;
    return switch (event.severity) {
      'CRITICAL' => criticalEvent,
      'HIGH' => highEvent,
      'MEDIUM' => mediumEvent,
      _ => otherEvent,
    };
  }

  static Future<GoogleMarkerIcons> create({
    required double devicePixelRatio,
  }) async {
    final size = GoogleMapLayers.markerDiameter;
    final icons = await Future.wait<google.BitmapDescriptor>(
      <Future<google.BitmapDescriptor>>[
        _glyphIcon(Icons.home_work, shelterMarkerColor, size, devicePixelRatio),
        _glyphIcon(
          Icons.local_hospital,
          medicalMarkerColor,
          size,
          devicePixelRatio,
        ),
        _glyphIcon(
          Icons.warning_amber_rounded,
          const Color(0xFFC62828),
          size,
          devicePixelRatio,
        ),
        _glyphIcon(
          Icons.warning_amber_rounded,
          const Color(0xFFEF6C00),
          size,
          devicePixelRatio,
        ),
        _glyphIcon(
          Icons.warning_amber_rounded,
          const Color(0xFFF9A825),
          size,
          devicePixelRatio,
        ),
        _glyphIcon(
          Icons.warning_amber_rounded,
          const Color(0xFF1565C0),
          size,
          devicePixelRatio,
        ),
        _glyphIcon(
          Icons.schedule,
          const Color(0xFF616161),
          size,
          devicePixelRatio,
        ),
        _locationDot(size, devicePixelRatio),
      ],
    );
    return GoogleMarkerIcons(
      shelter: icons[0],
      medical: icons[1],
      criticalEvent: icons[2],
      highEvent: icons[3],
      mediumEvent: icons[4],
      otherEvent: icons[5],
      expiredEvent: icons[6],
      currentLocation: icons[7],
    );
  }

  static Future<google.BitmapDescriptor> _glyphIcon(
    IconData icon,
    Color color,
    double logicalSize,
    double devicePixelRatio,
  ) async {
    final pixels = (logicalSize * devicePixelRatio).round();
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    final inset = 2 * devicePixelRatio;
    final rect = ui.Rect.fromLTWH(
      inset,
      inset,
      pixels - (inset * 2),
      pixels - (inset * 2),
    );
    final rrect = ui.RRect.fromRectAndRadius(
      rect,
      ui.Radius.circular(8 * devicePixelRatio),
    );
    final path = ui.Path()..addRRect(rrect);
    canvas.drawShadow(path, Colors.black45, 2 * devicePixelRatio, false);
    canvas.drawRRect(rrect, ui.Paint()..color = Colors.white);
    canvas.drawRRect(
      rrect,
      ui.Paint()
        ..color = color
        ..style = ui.PaintingStyle.stroke
        ..strokeWidth = 1.4 * devicePixelRatio,
    );

    final painter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(
          color: color,
          fontSize: 19 * devicePixelRatio,
          fontFamily: icon.fontFamily,
          package: icon.fontPackage,
          height: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(
      canvas,
      ui.Offset((pixels - painter.width) / 2, (pixels - painter.height) / 2),
    );
    return _finishBitmap(recorder, pixels, logicalSize);
  }

  static Future<google.BitmapDescriptor> _locationDot(
    double logicalSize,
    double devicePixelRatio,
  ) async {
    final pixels = (logicalSize * devicePixelRatio).round();
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    final center = ui.Offset(pixels / 2, pixels / 2);
    canvas.drawCircle(
      center,
      9 * devicePixelRatio,
      ui.Paint()..color = Colors.white,
    );
    canvas.drawCircle(
      center,
      6 * devicePixelRatio,
      ui.Paint()..color = const Color(0xFF1A73E8),
    );
    return _finishBitmap(recorder, pixels, logicalSize);
  }

  static Future<google.BitmapDescriptor> _finishBitmap(
    ui.PictureRecorder recorder,
    int pixels,
    double logicalSize,
  ) async {
    final image = await recorder.endRecording().toImage(pixels, pixels);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final bytes = data?.buffer.asUint8List();
    if (bytes == null || bytes.isEmpty) {
      throw StateError('Unable to render a neutral Google Maps marker icon');
    }
    return google.BitmapDescriptor.bytes(
      Uint8List.fromList(bytes),
      width: logicalSize,
      height: logicalSize,
    );
  }
}
