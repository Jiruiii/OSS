import 'map_models.dart';

const Set<String> _actionableNcdrRelevance = <String>{
  'EVACUATION',
  'ROUTE_CHANGE',
  'HIGH_IMPACT',
};

/// Keeps NCDR background notices out of the operational map.
///
/// Non-NCDR events remain visible because CWA and TDX use their own event
/// semantics. NCDR events fail closed when the pipeline has not classified
/// them, so an administrative notice cannot appear as an emergency marker by
/// accident.
bool isMapVisibleEvent(MeshEvent event) {
  final isNcdr = event.source == 'NCDR' || event.namespace == 'official.ncdr';
  if (!isNcdr) return true;

  final mapVisible = event.attributes?['map_visible'];
  if (mapVisible is bool) return mapVisible;

  final relevance = event.attributes?['operational_relevance'];
  return relevance is String && _actionableNcdrRelevance.contains(relevance);
}

List<MeshEvent> filterMapEvents(Iterable<MeshEvent> events) =>
    List<MeshEvent>.unmodifiable(events.where(isMapVisibleEvent));
