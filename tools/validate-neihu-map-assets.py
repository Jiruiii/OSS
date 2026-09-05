#!/usr/bin/env python3
"""Validate the versioned Neihu offline display document and tile assets."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any


EXPECTED_BOUNDS = [121.5519933, 25.0518603, 121.6286149, 25.1151519]
EXPECTED_SCHEMA = "offline-map-display-v1"
EXPECTED_DATASET = "resilientgeo-neihu"
EXPECTED_COUNTS = {"ROAD": 5774, "SHELTER": 26, "MEDICAL": 4}
TILE_SIZE = 256
BACKGROUND = bytes((242, 246, 248))
ROAD_COLOR = bytes((105, 119, 132))


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return document


def tile_x(lon: float, zoom: int) -> int:
    return math.floor((lon + 180.0) / 360.0 * (2**zoom))


def tile_y(lat: float, zoom: int) -> int:
    latitude = max(-85.05112878, min(85.05112878, lat))
    sine = math.sin(math.radians(latitude))
    normalized = (1.0 - math.asinh(sine / math.sqrt(1 - sine * sine)) / math.pi) / 2.0
    return math.floor(normalized * (2**zoom))


def expected_tiles(bounds: list[float], min_zoom: int, max_zoom: int) -> set[tuple[int, int, int]]:
    min_lon, min_lat, max_lon, max_lat = bounds
    result: set[tuple[int, int, int]] = set()
    for zoom in range(min_zoom, max_zoom + 1):
        count = 2**zoom
        x_min = max(0, min(count - 1, tile_x(min_lon, zoom)))
        x_max = max(0, min(count - 1, tile_x(max_lon, zoom)))
        y_min = max(0, min(count - 1, tile_y(max_lat, zoom)))
        y_max = max(0, min(count - 1, tile_y(min_lat, zoom)))
        result.update(
            (zoom, x, y)
            for x in range(x_min, x_max + 1)
            for y in range(y_min, y_max + 1)
        )
    return result


def coordinates(geometry: dict[str, Any]) -> list[list[float]]:
    if geometry.get("type") == "Point":
        values = geometry.get("coordinates")
        return [values] if isinstance(values, list) else []
    if geometry.get("type") == "LineString":
        values = geometry.get("coordinates")
        return values if isinstance(values, list) else []
    raise ValueError(f"unsupported geometry type: {geometry.get('type')}")


def field(feature: dict[str, Any], name: str) -> tuple[bool, Any]:
    if name in feature:
        return True, feature[name]
    properties = feature.get("properties")
    if isinstance(properties, dict) and name in properties:
        return True, properties[name]
    return False, None


def validate_document(document: dict[str, Any], *, label: str) -> None:
    if document.get("schema_version") != EXPECTED_SCHEMA:
        raise ValueError(f"{label}: schema_version must be {EXPECTED_SCHEMA}")
    if document.get("dataset_id") != EXPECTED_DATASET:
        raise ValueError(f"{label}: dataset_id must be {EXPECTED_DATASET}")
    bounds = document.get("bounds")
    if bounds != EXPECTED_BOUNDS:
        raise ValueError(f"{label}: bounds must be {EXPECTED_BOUNDS}")
    sources = document.get("sources")
    if not isinstance(sources, list) or not any(
        isinstance(source, dict)
        and source.get("source_id") == "osm-neihu"
        and "OpenStreetMap" in str(source.get("attribution", ""))
        for source in sources
    ):
        raise ValueError(f"{label}: OSM attribution is missing")
    features = document.get("features")
    if not isinstance(features, list):
        raise ValueError(f"{label}: features must be a list")

    ids: set[str] = set()
    counts = {key: 0 for key in EXPECTED_COUNTS}
    min_lon, min_lat, max_lon, max_lat = EXPECTED_BOUNDS
    for index, feature in enumerate(features):
        if not isinstance(feature, dict):
            raise ValueError(f"{label}: feature {index} is not an object")
        feature_id = feature.get("id")
        if not isinstance(feature_id, str) or not feature_id:
            raise ValueError(f"{label}: feature {index} has no unique string id")
        if feature_id in ids:
            raise ValueError(f"{label}: duplicate feature id {feature_id}")
        ids.add(feature_id)
        kind = str(feature.get("kind", "")).upper()
        if kind == "MEDICAL_FACILITY":
            kind = "MEDICAL"
        if kind not in counts:
            raise ValueError(f"{label}: unsupported feature kind {feature.get('kind')}")
        counts[kind] += 1
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            raise ValueError(f"{label}: {feature_id} has no geometry")
        points = coordinates(geometry)
        if geometry.get("type") == "Point" and len(points) != 1:
            raise ValueError(f"{label}: {feature_id} Point is malformed")
        if geometry.get("type") == "LineString" and len(points) < 2:
            raise ValueError(f"{label}: {feature_id} LineString needs two points")
        if not points:
            raise ValueError(f"{label}: {feature_id} has no coordinates")
        feature_min_lon = float("inf")
        feature_min_lat = float("inf")
        feature_max_lon = float("-inf")
        feature_max_lat = float("-inf")
        for point in points:
            if not isinstance(point, list) or len(point) < 2:
                raise ValueError(f"{label}: {feature_id} has malformed coordinate")
            lon, lat = point[0], point[1]
            if isinstance(lon, bool) or isinstance(lat, bool):
                raise ValueError(f"{label}: {feature_id} has non-numeric coordinate")
            lon = float(lon)
            lat = float(lat)
            if not math.isfinite(lon) or not math.isfinite(lat):
                raise ValueError(f"{label}: {feature_id} has non-finite coordinate")
            feature_min_lon = min(feature_min_lon, lon)
            feature_min_lat = min(feature_min_lat, lat)
            feature_max_lon = max(feature_max_lon, lon)
            feature_max_lat = max(feature_max_lat, lat)
        intersects = not (
            feature_max_lon < min_lon
            or feature_min_lon > max_lon
            or feature_max_lat < min_lat
            or feature_min_lat > max_lat
        )
        if not intersects:
            raise ValueError(f"{label}: {feature_id} does not intersect Neihu bounds")
        if kind == "SHELTER":
            present, available = field(feature, "available_count")
            if not present or available is not None:
                raise ValueError(f"{label}: {feature_id} available_count must be null")

    if counts != EXPECTED_COUNTS:
        raise ValueError(f"{label}: feature counts {counts} != {EXPECTED_COUNTS}")


def read_png(path: Path) -> tuple[int, int, bytes]:
    payload = path.read_bytes()
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"invalid PNG signature: {path}")
    offset = 8
    width = height = None
    compressed = bytearray()
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise ValueError(f"truncated PNG: {path}")
        size = struct.unpack(">I", payload[offset : offset + 4])[0]
        kind = payload[offset + 4 : offset + 8]
        chunk = payload[offset + 8 : offset + 8 + size]
        offset += 12 + size
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if (depth, color_type, interlace) != (8, 2, 0):
                raise ValueError(f"unsupported PNG format: {path}")
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break
    if width != TILE_SIZE or height != TILE_SIZE:
        raise ValueError(f"tile is not 256x256: {path}")
    decoded = zlib.decompress(bytes(compressed))
    expected_length = TILE_SIZE * (1 + TILE_SIZE * 3)
    if len(decoded) != expected_length:
        raise ValueError(f"unexpected PNG scanline size: {path}")
    return width, height, decoded


def has_road_pixels(decoded: bytes) -> bool:
    stride = 1 + TILE_SIZE * 3
    return any(
        decoded[row * stride + 1 + column * 3 : row * stride + 1 + column * 3 + 3] == ROAD_COLOR
        for row in range(TILE_SIZE)
        for column in range(TILE_SIZE)
    )


def validate_tiles(tile_root: Path, bounds: list[float], min_zoom: int, max_zoom: int) -> int:
    expected = expected_tiles(bounds, min_zoom, max_zoom)
    actual: set[tuple[int, int, int]] = set()
    for path in tile_root.rglob("*.png") if tile_root.exists() else []:
        try:
            zoom = int(path.parent.parent.name)
            x = int(path.parent.name)
            y = int(path.stem)
        except ValueError as exc:
            raise ValueError(f"invalid tile path: {path}") from exc
        actual.add((zoom, x, y))
        read_png(path)
    if actual != expected:
        missing = sorted(expected - actual)[:5]
        extra = sorted(actual - expected)[:5]
        raise ValueError(f"tile coverage mismatch; missing={missing}, extra={extra}")
    if max_zoom >= 17:
        visible = False
        for zoom, x, y in expected:
            if zoom != max_zoom:
                continue
            _, _, decoded = read_png(tile_root / str(zoom) / str(x) / f"{y}.png")
            visible = visible or has_road_pixels(decoded)
        if not visible:
            raise ValueError(f"no road-colored pixels found at zoom {max_zoom}")
    return len(actual)


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=root / "data/fixtures/neihu/offline-map-display-v1.json")
    parser.add_argument("--static-features", type=Path, default=root / "flutter/assets/data/neihu/static-features.json")
    parser.add_argument("--tile-root", type=Path, default=root / "flutter/assets/map/tiles")
    parser.add_argument("--min-zoom", type=int, default=12)
    parser.add_argument("--max-zoom", type=int, default=17)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fixture = load(args.fixture)
    static = load(args.static_features)
    validate_document(fixture, label="fixture")
    validate_document(static, label="static-features")
    if fixture != static:
        raise ValueError("static-features must be an exact copy of the versioned fixture")
    tile_count = validate_tiles(args.tile_root, fixture["bounds"], args.min_zoom, args.max_zoom)
    print(f"valid: {len(fixture['features'])} features, {tile_count} tiles ({args.min_zoom}-{args.max_zoom})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"invalid: {exc}", file=sys.stderr)
        raise SystemExit(1)
