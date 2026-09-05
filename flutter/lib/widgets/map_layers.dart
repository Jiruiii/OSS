import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../data/map_models.dart';

typedef StaticFeatureSelection = void Function(List<StaticFeature> features);
typedef MeshEventSelection = void Function(MeshEvent event);

/// Converts display models to the map layers; selection state remains in MapScreen.
class MapLayers {
  const MapLayers._();

  static List<Widget> build({
    required List<StaticFeature> features,
    required List<MeshEvent> events,
    required bool showShelters,
    required bool showMedical,
    required bool showEvents,
    required StaticFeatureSelection onStaticFeatureSelected,
    required MeshEventSelection onEventSelected,
    GeoPoint? currentLocation,
    Set<String> pulsingEventKeys = const <String>{},
    double pulseFraction = 0,
  }) {
    final visibleFacilities = features
        .where((feature) {
          return (showShelters && feature.kind == 'shelter') ||
              (showMedical && feature.kind == 'medical');
        })
        .toList(growable: false);
    final facilityMarkers = _facilityMarkers(
      visibleFacilities,
      onStaticFeatureSelected,
    );
    final visibleEvents =
        showEvents
            ? events
                .where((event) => event.geometry != null)
                .toList(growable: false)
            : const <MeshEvent>[];

    return <Widget>[
      _EventGeometryLayers(
        events: visibleEvents,
        onEventSelected: onEventSelected,
      ),
      if (pulsingEventKeys.isNotEmpty)
        CircleLayer(
          circles: visibleEvents
              .where((event) => pulsingEventKeys.contains(eventKey(event)))
              .map(
                (event) => CircleMarker(
                  point: _eventPoint(event),
                  radius: 14 + (18 * pulseFraction),
                  color: eventColor(event).withValues(alpha: 0.10),
                  borderColor: eventColor(event).withValues(alpha: 0.65),
                  borderStrokeWidth: 2,
                ),
              )
              .toList(growable: false),
        ),
      MarkerLayer(
        markers: <Marker>[
          ...facilityMarkers,
          ...visibleEvents.map((event) => _eventMarker(event, onEventSelected)),
          if (currentLocation != null) _locationMarker(currentLocation),
        ],
      ),
    ];
  }

  static List<Marker> _facilityMarkers(
    List<StaticFeature> features,
    StaticFeatureSelection onSelected,
  ) {
    final grouped = <String, List<StaticFeature>>{};
    for (final feature in features) {
      final geometry = feature.geometry;
      if (geometry is! PointGeometry) continue;
      final key = '${geometry.point.longitude}:${geometry.point.latitude}';
      grouped.putIfAbsent(key, () => <StaticFeature>[]).add(feature);
    }

    return grouped.values
        .map((group) {
          final point = (group.first.geometry! as PointGeometry).point;
          final names = group.map(featureName).join('、');
          final label = group.length == 1 ? names : '重疊地點：$names';
          final isMedicalOnly = group.every(
            (feature) => feature.kind == 'medical',
          );
          return Marker(
            key: ValueKey<String>('static-marker-${group.first.id ?? names}'),
            point: _latLng(point),
            width: 34,
            height: 34,
            child: _MapMarkerButton(
              semanticLabel: label,
              icon: isMedicalOnly ? Icons.local_hospital : Icons.home_work,
              onTap: () => onSelected(group),
            ),
          );
        })
        .toList(growable: false);
  }

  static Marker _eventMarker(MeshEvent event, MeshEventSelection onSelected) {
    final point = _eventGeoPoint(event);
    final name = eventName(event);
    return Marker(
      key: ValueKey<String>('event-marker-${meshEventIdentity(event)}'),
      point: _latLng(point),
      width: 34,
      height: 34,
      child: _MapMarkerButton(
        semanticLabel: '事件：$name${event.isExpired ? '，已過期' : ''}',
        icon: event.isExpired ? Icons.schedule : Icons.warning_amber_rounded,
        onTap: () => onSelected(event),
      ),
    );
  }

  static Polyline<MeshEvent> _eventPolyline(MeshEvent event) {
    final geometry = event.geometry! as LineStringGeometry;
    return Polyline<MeshEvent>(
      points: geometry.points.map(_latLng).toList(growable: false),
      color: eventColor(event),
      strokeWidth: event.isExpired ? 4 : 6,
      pattern:
          event.isExpired
              ? const StrokePattern.dotted(spacingFactor: 2)
              : const StrokePattern.solid(),
      hitValue: event,
    );
  }

  static Polygon<MeshEvent> _eventPolygon(MeshEvent event) {
    final geometry = event.geometry! as PolygonGeometry;
    final rings = geometry.rings;
    return Polygon<MeshEvent>(
      points: rings.first.map(_latLng).toList(growable: false),
      holePointsList:
          rings.length > 1
              ? rings.skip(1).map((ring) => ring.map(_latLng).toList()).toList()
              : null,
      color: eventColor(event).withValues(alpha: event.isExpired ? 0.12 : 0.28),
      borderColor: eventColor(event),
      borderStrokeWidth: 3,
      hitValue: event,
    );
  }

  static LatLng _latLng(GeoPoint point) =>
      LatLng(point.latitude, point.longitude);

  static GeoPoint _eventGeoPoint(MeshEvent event) {
    final geometry = event.geometry!;
    return switch (geometry) {
      PointGeometry(:final point) => point,
      LineStringGeometry(:final points) => points[points.length ~/ 2],
      PolygonGeometry(:final rings) => rings.first.first,
    };
  }

  static LatLng _eventPoint(MeshEvent event) => _latLng(_eventGeoPoint(event));

  static Marker _locationMarker(GeoPoint location) => Marker(
    key: const ValueKey<String>('current-location-marker'),
    point: _latLng(location),
    width: 24,
    height: 24,
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFF1A73E8),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const <BoxShadow>[
          BoxShadow(color: Colors.black26, blurRadius: 4),
        ],
      ),
    ),
  );
}

class _EventGeometryLayers extends StatefulWidget {
  const _EventGeometryLayers({
    required this.events,
    required this.onEventSelected,
  });

  final List<MeshEvent> events;
  final MeshEventSelection onEventSelected;

  @override
  State<_EventGeometryLayers> createState() => _EventGeometryLayersState();
}

class _EventGeometryLayersState extends State<_EventGeometryLayers> {
  final LayerHitNotifier<MeshEvent> _lineHits = ValueNotifier(null);
  final LayerHitNotifier<MeshEvent> _polygonHits = ValueNotifier(null);

  @override
  void initState() {
    super.initState();
    _lineHits.addListener(_selectLineHit);
    _polygonHits.addListener(_selectPolygonHit);
  }

  @override
  void dispose() {
    _lineHits
      ..removeListener(_selectLineHit)
      ..dispose();
    _polygonHits
      ..removeListener(_selectPolygonHit)
      ..dispose();
    super.dispose();
  }

  void _selectLineHit() => _select(_lineHits.value?.hitValues);

  void _selectPolygonHit() => _select(_polygonHits.value?.hitValues);

  void _select(List<MeshEvent>? events) {
    if (events == null || events.isEmpty) return;
    widget.onEventSelected(events.first);
  }

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: <Widget>[
      PolylineLayer<MeshEvent>(
        polylines: widget.events
            .where((event) => event.geometry is LineStringGeometry)
            .map(MapLayers._eventPolyline)
            .toList(growable: false),
        hitNotifier: _lineHits,
      ),
      PolygonLayer<MeshEvent>(
        polygons: widget.events
            .where((event) => event.geometry is PolygonGeometry)
            .map(MapLayers._eventPolygon)
            .toList(growable: false),
        hitNotifier: _polygonHits,
      ),
    ],
  );
}

String featureName(StaticFeature feature) {
  final name = feature.details['name'];
  return name is String && name.isNotEmpty ? name : (feature.id ?? '未命名設施');
}

String eventName(MeshEvent event) {
  final attributes = event.attributes;
  for (final key in <String>[
    'name',
    'title',
    'road_name',
    'source_description',
    'alert_id',
  ]) {
    final value = attributes?[key];
    if (value is String && value.isNotEmpty) return value;
  }
  return event.eventType ?? event.eventId ?? '未命名事件';
}

Color eventColor(MeshEvent event) {
  if (event.isExpired) return Colors.grey.shade700;
  return switch (event.severity) {
    'CRITICAL' => const Color(0xFFC62828),
    'HIGH' => const Color(0xFFEF6C00),
    'MEDIUM' => const Color(0xFFF9A825),
    _ => const Color(0xFF1565C0),
  };
}

class _MapMarkerButton extends StatelessWidget {
  const _MapMarkerButton({
    required this.semanticLabel,
    required this.icon,
    required this.onTap,
  });

  final String semanticLabel;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: semanticLabel,
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(
              color: Theme.of(context).colorScheme.onSurface,
              width: 1.4,
            ),
            boxShadow: const <BoxShadow>[
              BoxShadow(color: Colors.black26, blurRadius: 4),
            ],
          ),
          child: Icon(
            icon,
            color: Theme.of(context).colorScheme.onSurface,
            size: 20,
          ),
        ),
      ),
    ),
  );
}

String eventKey(MeshEvent event) =>
    meshEventIdentity(event);
