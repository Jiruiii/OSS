#!/usr/bin/env python3
"""Build the versioned Neihu static map asset and deterministic PNG tiles.

The normal build reads only the committed display fixture.  The optional
source arguments are intentionally explicit and are used once to create a
new versioned fixture from a collector snapshot; they are never runtime
inputs for the Flutter app.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any, Iterable


BOUNDS = [121.5519933, 25.0518603, 121.6286149, 25.1151519]
SCHEMA_VERSION = "offline-map-display-v1"
DATASET_ID = "resilientgeo-neihu"
TILE_SIZE = 256
DEFAULT_MIN_ZOOM = 12
DEFAULT_MAX_ZOOM = 17
ROAD_COLOR = (105, 119, 132)
BACKGROUND_COLOR = (242, 246, 248)


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def source_feature_properties(feature: dict[str, Any]) -> dict[str, Any]:
    properties = feature.get("properties")
    return properties if isinstance(properties, dict) else {}


def source_timestamp(document: dict[str, Any], fallback: str) -> str:
    features = document.get("features")
    if isinstance(features, list) and features:
        first = features[0]
        if isinstance(first, dict):
            for key in ("issued_at", "source_version"):
                value = first.get(key)
                if isinstance(value, str) and value:
                    return value
    for key in ("retrieved_at", "snapshot_at"):
        value = document.get(key)
        if isinstance(value, str) and value:
            return value
    return fallback


def make_display_feature(
    feature: dict[str, Any],
    *,
    kind: str,
    source: str,
) -> dict[str, Any]:
    properties = source_feature_properties(feature)
    tags = properties.get("tags") if isinstance(properties.get("tags"), dict) else {}
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise ValueError(f"feature has no geometry: {feature.get('feature_id')}")
    result: dict[str, Any] = {
        "id": feature.get("feature_id"),
        "kind": kind,
        "geometry": geometry,
        "source": source,
    }
    name = properties.get("name") or tags.get("name") or tags.get("name:zh")
    if name is not None:
        result["name"] = name
    address = properties.get("address") or tags.get("addr:full")
    if address is not None:
        result["address"] = address
    if kind == "road":
        result["road_class"] = tags.get("highway") or properties.get("road_class")
    return result


def make_shelter_feature(feature: dict[str, Any]) -> dict[str, Any]:
    properties = source_feature_properties(feature)
    result = make_display_feature(feature, kind="shelter", source="taipei-shelter")
    result["name"] = properties.get("name")
    result["address"] = properties.get("address")
    result["capacity"] = properties.get("capacity")
    result["available_count"] = None
    result["disaster_types"] = properties.get("disaster_types") or []
    return result


def make_medical_feature(feature: dict[str, Any]) -> dict[str, Any]:
    properties = source_feature_properties(feature)
    result = make_display_feature(
        feature, kind="medical", source="taipei-medical"
    )
    result["name"] = properties.get("name")
    result["address"] = properties.get("address")
    result["facility_type"] = properties.get("facility_type") or "醫療院所"
    return result


def assemble_fixture(
    osm_path: Path, shelter_path: Path, medical_path: Path
) -> dict[str, Any]:
    osm = read_json(osm_path)
    shelter = read_json(shelter_path)
    medical = read_json(medical_path)
    snapshot_at = source_timestamp(osm, "2026-09-04T17:58:15Z")
    features: list[dict[str, Any]] = []

    for feature in osm.get("features", []):
        if isinstance(feature, dict) and feature.get("feature_type") == "ROAD":
            features.append(make_display_feature(feature, kind="road", source="osm-neihu"))
    for feature in shelter.get("features", []):
        if isinstance(feature, dict):
            features.append(make_shelter_feature(feature))
    for feature in medical.get("features", []):
        if isinstance(feature, dict):
            features.append(make_medical_feature(feature))

    return {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": DATASET_ID,
        "snapshot_at": snapshot_at,
        "bounds": BOUNDS,
        "sources": [
            {
                "source_id": "osm-neihu",
                "snapshot_at": snapshot_at,
                "attribution": "© OpenStreetMap contributors",
                "attribution_url": "https://www.openstreetmap.org/copyright",
            },
            {
                "source_id": "taipei-shelter",
                "snapshot_at": source_timestamp(shelter, snapshot_at),
            },
            {
                "source_id": "taipei-medical",
                "snapshot_at": source_timestamp(medical, snapshot_at),
            },
        ],
        "features": features,
    }


def lon_to_world_x(lon: float, zoom: int) -> float:
    return (lon + 180.0) / 360.0 * (2**zoom * TILE_SIZE)


def lat_to_world_y(lat: float, zoom: int) -> float:
    latitude = max(-85.05112878, min(85.05112878, lat))
    sine = math.sin(math.radians(latitude))
    world = 2**zoom * TILE_SIZE
    return (0.5 - math.asinh(sine / math.sqrt(1 - sine * sine)) / (2 * math.pi)) * world


def tile_ranges(bounds: list[float], zoom: int) -> list[tuple[int, int, int]]:
    min_lon, min_lat, max_lon, max_lat = bounds
    count = 2**zoom
    x_min = max(0, min(count - 1, math.floor(lon_to_world_x(min_lon, zoom) / TILE_SIZE)))
    x_max = max(0, min(count - 1, math.floor(lon_to_world_x(max_lon, zoom) / TILE_SIZE)))
    y_min = max(0, min(count - 1, math.floor(lat_to_world_y(max_lat, zoom) / TILE_SIZE)))
    y_max = max(0, min(count - 1, math.floor(lat_to_world_y(min_lat, zoom) / TILE_SIZE)))
    return [(zoom, x, y) for x in range(x_min, x_max + 1) for y in range(y_min, y_max + 1)]


def road_width(road_class: Any) -> int:
    if road_class in {"motorway", "trunk"}:
        return 4
    if road_class in {"primary", "secondary"}:
        return 3
    if road_class in {"tertiary", "unclassified"}:
        return 2
    return 1


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def encode_png(width: int, height: int, pixels: bytearray) -> bytes:
    rows = bytearray()
    stride = width * 3
    for y in range(height):
        rows.append(0)
        rows.extend(pixels[y * stride : (y + 1) * stride])
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
            png_chunk(b"IEND", b""),
        ]
    )


def paint_pixel(pixels: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    if 0 <= x < TILE_SIZE and 0 <= y < TILE_SIZE:
        offset = (y * TILE_SIZE + x) * 3
        pixels[offset : offset + 3] = bytes(color)


def paint_segment(
    pixels: bytearray,
    start: tuple[float, float],
    end: tuple[float, float],
    width: int,
) -> None:
    x0, y0 = start
    x1, y1 = end
    if max(x0, x1) < -width or min(x0, x1) >= TILE_SIZE + width:
        return
    if max(y0, y1) < -width or min(y0, y1) >= TILE_SIZE + width:
        return
    dx = x1 - x0
    dy = y1 - y0
    steps = max(abs(dx), abs(dy), 1.0)
    for step in range(int(steps) + 1):
        ratio = step / steps
        x = round(x0 + dx * ratio)
        y = round(y0 + dy * ratio)
        radius = max(0, width // 2)
        for offset_x in range(-radius, radius + 1):
            for offset_y in range(-radius, radius + 1):
                paint_pixel(pixels, x + offset_x, y + offset_y, ROAD_COLOR)


def geometry_points(feature: dict[str, Any], zoom: int) -> list[tuple[float, float]]:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        return []
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return []
    points: list[tuple[float, float]] = []
    for coordinate in coordinates:
        if isinstance(coordinate, list) and len(coordinate) >= 2:
            points.append(
                (lon_to_world_x(float(coordinate[0]), zoom), lat_to_world_y(float(coordinate[1]), zoom))
            )
    return points


def render_tiles(document: dict[str, Any], tile_root: Path, min_zoom: int, max_zoom: int) -> int:
    roads = [
        feature
        for feature in document.get("features", [])
        if isinstance(feature, dict) and str(feature.get("kind", "")).upper() == "ROAD"
    ]
    rendered = 0
    for zoom in range(min_zoom, max_zoom + 1):
        tile_list = tile_ranges(document["bounds"], zoom)
        buckets: dict[tuple[int, int], list[tuple[list[tuple[float, float]], int]]] = {}
        for feature in roads:
            points = geometry_points(feature, zoom)
            if len(points) < 2:
                continue
            min_x = math.floor(min(point[0] for point in points) / TILE_SIZE)
            max_x = math.floor(max(point[0] for point in points) / TILE_SIZE)
            min_y = math.floor(min(point[1] for point in points) / TILE_SIZE)
            max_y = math.floor(max(point[1] for point in points) / TILE_SIZE)
            width = road_width(feature.get("road_class"))
            for x in range(min_x, max_x + 1):
                for y in range(min_y, max_y + 1):
                    buckets.setdefault((x, y), []).append((points, width))

        for _, x, y in tile_list:
            pixels = bytearray(BACKGROUND_COLOR * (TILE_SIZE * TILE_SIZE))
            for points, width in buckets.get((x, y), []):
                local = [(point[0] - x * TILE_SIZE, point[1] - y * TILE_SIZE) for point in points]
                for start, end in zip(local, local[1:]):
                    paint_segment(pixels, start, end, width)
            output = tile_root / str(zoom) / str(x) / f"{y}.png"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(encode_png(TILE_SIZE, TILE_SIZE, pixels))
            rendered += 1
    return rendered


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=root / "data/fixtures/neihu/offline-map-display-v1.json")
    parser.add_argument("--static-output", type=Path, default=root / "flutter/assets/data/neihu/static-features.json")
    parser.add_argument("--tile-root", type=Path, default=root / "flutter/assets/map/tiles")
    parser.add_argument("--min-zoom", type=int, default=DEFAULT_MIN_ZOOM)
    parser.add_argument("--max-zoom", type=int, default=DEFAULT_MAX_ZOOM)
    parser.add_argument("--source-osm", type=Path)
    parser.add_argument("--source-shelter", type=Path)
    parser.add_argument("--source-medical", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.min_zoom < 0 or args.max_zoom < args.min_zoom:
        raise SystemExit("invalid zoom range")
    source_paths = (args.source_osm, args.source_shelter, args.source_medical)
    if any(path is not None for path in source_paths):
        if not all(path is not None for path in source_paths):
            raise SystemExit("all three source arguments are required together")
        document = assemble_fixture(*source_paths)  # type: ignore[arg-type]
        write_json(args.fixture, document)
    else:
        document = read_json(args.fixture)
    write_json(args.static_output, document)
    rendered = render_tiles(document, args.tile_root, args.min_zoom, args.max_zoom)
    print(f"wrote {args.static_output} and {rendered} tiles ({args.min_zoom}-{args.max_zoom})")
    return 0


if __name__ == "__main__":
    main()
