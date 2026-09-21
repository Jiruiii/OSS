import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../data/map_models.dart';

typedef StaticFeatureSelection = void Function(List<StaticFeature> features);
typedef MeshEventSelection = void Function(MeshEvent event);

const Color shelterMarkerColor = Color(0xFF0F766E);
const Color medicalMarkerColor = Color(0xFF4F46E5);

/// App-owned icons stay in one catalog so map markers and notification cards
/// cannot drift back to platform-specific Material glyphs.
class MapIconCatalog {
  const MapIconCatalog._();

  static const IconData disaster = LucideIcons.triangleAlert;
  static const IconData expiredEvent = LucideIcons.clock3;
  static const IconData shelter = LucideIcons.house;
  static const IconData medical = LucideIcons.hospital;
}

class MapMarkerData {
  const MapMarkerData({
    required this.key,
    required this.point,
    required this.width,
    required this.height,
    required this.child,
  });

  final Key key;
  final GeoPoint point;
  final double width;
  final double height;
  final Widget child;
}

/// Converts provider-neutral map models to Flutter overlay markers.
///
/// MapLibre owns basemap and line/polygon rendering. These widgets stay above
/// the platform view to preserve overlap selection and accessibility semantics.
class MapLayers {
  const MapLayers._();

  static List<MapMarkerData> buildMarkers({
    required List<StaticFeature> features,
    required List<MeshEvent> events,
    required bool showShelters,
    required bool showMedical,
    required bool showEvents,
    required StaticFeatureSelection onStaticFeatureSelected,
    required MeshEventSelection onEventSelected,
    GeoPoint? currentLocation,
  }) {
    final visibleFacilities = features
        .where(
          (feature) =>
              (showShelters && feature.kind == 'shelter') ||
              (showMedical && feature.kind == 'medical'),
        )
        .toList(growable: false);
    return <MapMarkerData>[
      ..._facilityMarkers(visibleFacilities, onStaticFeatureSelected),
      if (showEvents)
        ...events
            .where((event) => meshEventFocusPoint(event) != null)
            .map((event) => _eventMarker(event, onEventSelected)),
      if (currentLocation != null) _locationMarker(currentLocation),
    ];
  }

  static List<MapMarkerData> _facilityMarkers(
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
          return MapMarkerData(
            key: ValueKey<String>('static-marker-${group.first.id ?? names}'),
            point: point,
            width: 40,
            height: 40,
            child: _MapMarkerButton(
              semanticLabel: label,
              icon:
                  isMedicalOnly
                      ? MapIconCatalog.medical
                      : MapIconCatalog.shelter,
              color: isMedicalOnly ? medicalMarkerColor : shelterMarkerColor,
              shape:
                  isMedicalOnly
                      ? RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: const BorderSide(color: Colors.white, width: 2),
                      )
                      : const CircleBorder(
                        side: BorderSide(color: Colors.white, width: 2),
                      ),
              onTap: () => onSelected(group),
            ),
          );
        })
        .toList(growable: false);
  }

  static MapMarkerData _eventMarker(
    MeshEvent event,
    MeshEventSelection onSelected,
  ) {
    final point = meshEventFocusPoint(event)!;
    final name = eventName(event);
    return MapMarkerData(
      key: ValueKey<String>('event-marker-${meshEventIdentity(event)}'),
      point: point,
      width: 38,
      height: 38,
      child: _MapMarkerButton(
        semanticLabel: '事件：$name${event.isExpired ? '，已過期' : ''}',
        icon:
            event.isExpired
                ? MapIconCatalog.expiredEvent
                : MapIconCatalog.disaster,
        color: eventColor(event),
        shape:
            event.isExpired
                ? const CircleBorder(
                  side: BorderSide(color: Colors.white, width: 2),
                )
                : BeveledRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: Colors.white, width: 2),
                ),
        onTap: () => onSelected(event),
      ),
    );
  }

  static MapMarkerData _locationMarker(GeoPoint location) => MapMarkerData(
    key: const ValueKey<String>('current-location-marker'),
    point: location,
    width: 24,
    height: 24,
    child: const DecoratedBox(
      decoration: BoxDecoration(
        color: Color(0xFF1A73E8),
        shape: BoxShape.circle,
        border: Border.fromBorderSide(
          BorderSide(color: Colors.white, width: 3),
        ),
        boxShadow: <BoxShadow>[BoxShadow(color: Colors.black26, blurRadius: 4)],
      ),
    ),
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
  if (event.isExpired) return const Color(0xFF64748B);
  return switch (event.severity) {
    'CRITICAL' => const Color(0xFFD92D20),
    'HIGH' => const Color(0xFFF97316),
    'MEDIUM' => const Color(0xFFD97706),
    _ => const Color(0xFF2563EB),
  };
}

class _MapMarkerButton extends StatelessWidget {
  const _MapMarkerButton({
    required this.semanticLabel,
    required this.icon,
    required this.color,
    required this.shape,
    required this.onTap,
  });

  final String semanticLabel;
  final IconData icon;
  final Color color;
  final ShapeBorder shape;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    container: true,
    label: semanticLabel,
    child: SizedBox.expand(
      child: Material(
        color: color,
        elevation: 4,
        shadowColor: color.withValues(alpha: 0.55),
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          customBorder: shape,
          onTap: onTap,
          splashColor: Colors.white.withValues(alpha: 0.24),
          highlightColor: Colors.white.withValues(alpha: 0.12),
          child: Icon(icon, color: Colors.white, size: 21),
        ),
      ),
    ),
  );
}

String eventKey(MeshEvent event) => meshEventIdentity(event);
