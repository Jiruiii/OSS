#!/usr/bin/env bash
set -euo pipefail

# Rebuild the five archives used by the Flutter MapLibre styles.
# Override PMTILES_BIN, SOURCE_DATE, or OUTPUT_DIR for a reproducible local run.
PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
SOURCE_DATE="${SOURCE_DATE:-$(date -u +%Y%m%d)}"
SOURCE_URL="${SOURCE_URL:-https://build.protomaps.com/${SOURCE_DATE}.pmtiles}"
OUTPUT_DIR="${OUTPUT_DIR:-$(cd "$(dirname "$0")/../../flutter/assets/map/pmtiles" && pwd)}"

mkdir -p "$OUTPUT_DIR"

"$PMTILES_BIN" extract "$SOURCE_URL" "$OUTPUT_DIR/taiwan.pmtiles" \
  --bbox=118.0,21.8,122.2,26.5 --minzoom=0 --maxzoom=12
"$PMTILES_BIN" extract "$SOURCE_URL" "$OUTPUT_DIR/taiwan-north.pmtiles" \
  --bbox=118.0,24.0,122.2,26.5 --minzoom=13 --maxzoom=15
"$PMTILES_BIN" extract "$SOURCE_URL" "$OUTPUT_DIR/taiwan-central.pmtiles" \
  --bbox=118.0,23.0,121.6,24.1 --minzoom=13 --maxzoom=15
"$PMTILES_BIN" extract "$SOURCE_URL" "$OUTPUT_DIR/taiwan-south.pmtiles" \
  --bbox=118.0,21.8,121.6,23.8 --minzoom=13 --maxzoom=15
"$PMTILES_BIN" extract "$SOURCE_URL" "$OUTPUT_DIR/taiwan-east.pmtiles" \
  --bbox=120.8,21.8,122.2,25.5 --minzoom=13 --maxzoom=15

for archive in "$OUTPUT_DIR"/*.pmtiles; do
  "$PMTILES_BIN" show --header-json "$archive"
  "$PMTILES_BIN" verify "$archive"
  shasum -a 256 "$archive"
done
