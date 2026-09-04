/**
 * Geographic relevance filter (the Neihu plan's Cellular Savings lever).
 *
 * A node only wants chunks for its own area or an adjacent area; area-wide
 * warnings (theme `flood` — riverbank flood alerts that concern the whole
 * catchment) always pass, per docs/peer-sync-v0.md.
 *
 * Two deliberate choices vs the doc's literal wording:
 *   - We key on `area_id` membership, not a raw bbox rectangle test: chunks are
 *     already bucketed by area, and the OSM-derived chunk bboxes are too coarse
 *     (long road/river fragments) to discriminate. `node.attentionWindow` (union
 *     of own + adjacent area bboxes) is still carried for the report.
 *   - The bypass is theme-based (`flood`), not "any CRITICAL chunk": a single
 *     CLOSED road is CRITICAL but strictly local, so it should not defeat the
 *     filter. Only genuinely area-wide alerts bypass.
 */

const AREA_WIDE_THEMES = new Set(['flood']);

export function isRelevant(entry, node) {
  if (AREA_WIDE_THEMES.has(entry.theme)) return true;
  return node.areaSet.has(entry.area_id);
}

/** Filter manifest chunk entries. */
export function filterManifestEntries(entries, node, geoFilter) {
  if (!geoFilter) return entries;
  return entries.filter((entry) => isRelevant(entry, node));
}

/**
 * Filter DIFF `missing_chunks` / `stale_chunks` (chunk_id + priority + size, no
 * area_id) by looking the entry up in the manifest.
 */
export function filterWanted(wanted, node, geoFilter, manifestEntryById) {
  if (!geoFilter) return wanted;
  return wanted.filter((item) => {
    const entry = manifestEntryById.get(item.chunk_id);
    return entry ? isRelevant(entry, node) : false;
  });
}
