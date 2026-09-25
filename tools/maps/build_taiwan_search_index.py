#!/usr/bin/env python3
"""Build the deterministic offline Taiwan road search index.

The production input is a Geofabrik OSM PBF. A small GeoJSON-like JSON input
is also accepted when the file ends in ``.json``; that adapter is intentionally
used only by the checked-in generator contract tests.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "1"
DATASET_ID = "taiwan-roads"
ATTRIBUTION = "© OpenStreetMap contributors"
MIN_LONGITUDE = 118.0
MAX_LONGITUDE = 122.2
MIN_LATITUDE = 21.8
MAX_LATITUDE = 26.5


class BuildError(ValueError):
    """Raised when source data cannot satisfy the search asset contract."""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-pbf", required=True, type=Path)
    parser.add_argument("--source-date", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        document = build_document(
            input_path=arguments.input_pbf,
            source_date=arguments.source_date,
            source_url=arguments.source_url,
            declared_sha256=arguments.source_sha256,
        )
        write_document(arguments.output, document)
    except (BuildError, OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


def build_document(
    *,
    input_path: Path,
    source_date: str,
    source_url: str,
    declared_sha256: str,
) -> dict[str, Any]:
    validate_metadata(source_date, source_url, declared_sha256)
    if not input_path.is_file():
        raise BuildError(f"input source does not exist: {input_path}")

    actual_sha256 = sha256_file(input_path)
    if actual_sha256.lower() != declared_sha256.lower():
        raise BuildError(
            "SHA-256 mismatch: "
            f"declared {declared_sha256.lower()}, computed {actual_sha256}"
        )

    if input_path.suffix.lower() == ".json":
        roads = roads_from_fixture(input_path)
    else:
        roads = roads_from_pbf(input_path)

    entries = normalize_entries(roads)
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": DATASET_ID,
        "snapshot_at": source_date,
        "source_url": source_url,
        "source_sha256": actual_sha256,
        "attribution": ATTRIBUTION,
        "entries": entries,
    }


def validate_metadata(source_date: str, source_url: str, declared_sha256: str) -> None:
    if not source_date.strip():
        raise BuildError("source-date must not be empty")
    if not source_url.strip():
        raise BuildError("source-url must not be empty")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", declared_sha256):
        raise BuildError("source-sha256 must be a 64-character hex digest")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def roads_from_fixture(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    features = document.get("features")
    if not isinstance(features, list):
        raise BuildError("fixture must contain a features array")

    roads: list[dict[str, Any]] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not is_road(properties):
            continue
        source_id = str(feature.get("id", ""))
        road = road_record(
            source_id=source_id,
            tags=properties,
            coordinates=geometry_coordinates(geometry),
        )
        if road is not None:
            roads.append(road)
    return roads


def roads_from_pbf(path: Path) -> list[dict[str, Any]]:
    try:
        import osmium  # type: ignore[import-not-found]
    except ImportError as error:
        raise BuildError(
            "pyosmium is required for PBF input; install tools/maps/requirements-search.txt"
        ) from error

    roads: list[dict[str, Any]] = []

    class RoadHandler(osmium.SimpleHandler):  # type: ignore[misc, valid-type]
        def way(self, way: Any) -> None:
            tags = {tag.k: tag.v for tag in way.tags}
            if not is_road(tags):
                return
            coordinates = []
            for node in way.nodes:
                location = node.location
                if not location.valid():
                    coordinates = []
                    break
                coordinates.append((location.lon, location.lat))
            road = road_record(
                source_id=f"way:{way.id}",
                tags=tags,
                coordinates=coordinates,
            )
            if road is not None:
                roads.append(road)

    handler = RoadHandler()
    try:
        handler.apply_file(str(path), locations=True)
    except Exception as error:  # pyosmium exposes several native exceptions.
        raise BuildError(f"unable to read OSM PBF {path}: {error}") from error
    return roads


def is_road(tags: dict[str, Any]) -> bool:
    highway = tags.get("highway")
    return isinstance(highway, str) and bool(highway.strip())


def road_record(
    *, source_id: str, tags: dict[str, Any], coordinates: Iterable[Any]
) -> dict[str, Any] | None:
    name = first_text(tags, ("name:zh-Hant", "name", "ref"))
    if name is None:
        return {
            "id": source_id,
            "name": "",
            "aliases": [],
            "kind": "road",
            "region": None,
            "coordinate": None,
        }

    normalized_coordinates = normalize_coordinates(coordinates)
    if not normalized_coordinates:
        raise BuildError(f"named road has no usable coordinate: {source_id}")
    coordinate = midpoint(normalized_coordinates)
    if not coordinate_in_taiwan(coordinate):
        return None
    return {
        "id": source_id,
        "name": name,
        "aliases": aliases_from_tags(tags, name),
        "kind": "road",
        "region": first_text(
            tags,
            ("addr:city", "addr:county", "is_in:city", "行政區"),
        ),
        "coordinate": coordinate,
    }


def normalize_entries(roads: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for road in roads:
        name = road["name"]
        coordinate = road["coordinate"]
        if not name:
            continue
        if coordinate is None:
            raise BuildError(f"named road has no usable coordinate: {road['id']}")
        region = road.get("region") or ""
        key = (normalize_text(name), normalize_text(region), str(road["id"]))
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            {
                "id": str(road["id"]),
                "name": name,
                "aliases": sorted(set(road.get("aliases", []))),
                "kind": "road",
                "region": region or None,
                "coordinate": [coordinate[0], coordinate[1]],
            }
        )
    entries.sort(
        key=lambda entry: (
            normalize_text(entry["name"]),
            normalize_text(entry["region"]),
            entry["id"],
        )
    )
    return entries


def first_text(tags: dict[str, Any], keys: Iterable[str]) -> str | None:
    for key in keys:
        value = tags.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def aliases_from_tags(tags: dict[str, Any], name: str) -> list[str]:
    aliases: list[str] = []
    for key in ("alt_name", "official_name", "loc_name", "old_name"):
        value = tags.get(key)
        if not isinstance(value, str):
            continue
        for alias in re.split(r"[;,，、]", value):
            alias = alias.strip()
            if alias and alias != name:
                aliases.append(alias)
    return sorted(set(aliases))


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def normalize_coordinates(coordinates: Iterable[Any]) -> list[tuple[float, float]]:
    normalized: list[tuple[float, float]] = []
    for coordinate in coordinates:
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue
        try:
            longitude = float(coordinate[0])
            latitude = float(coordinate[1])
        except (TypeError, ValueError):
            continue
        if math.isfinite(longitude) and math.isfinite(latitude):
            normalized.append((longitude, latitude))
    return normalized


def geometry_coordinates(geometry: Any) -> list[Any]:
    if not isinstance(geometry, dict):
        return []
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, list):
        return coordinates
    if geometry_type == "MultiLineString" and isinstance(coordinates, list):
        return [point for line in coordinates if isinstance(line, list) for point in line]
    return []


def midpoint(coordinates: list[tuple[float, float]]) -> tuple[float, float]:
    if len(coordinates) == 1:
        return coordinates[0]
    total = sum(distance(left, right) for left, right in zip(coordinates, coordinates[1:]))
    if total <= 0:
        return coordinates[0]
    target = total / 2
    travelled = 0.0
    for left, right in zip(coordinates, coordinates[1:]):
        segment = distance(left, right)
        if travelled + segment >= target:
            ratio = (target - travelled) / segment if segment else 0
            return (
                left[0] + (right[0] - left[0]) * ratio,
                left[1] + (right[1] - left[1]) * ratio,
            )
        travelled += segment
    return coordinates[-1]


def distance(left: tuple[float, float], right: tuple[float, float]) -> float:
    return math.hypot(right[0] - left[0], right[1] - left[1])


def coordinate_in_taiwan(coordinate: tuple[float, float]) -> bool:
    longitude, latitude = coordinate
    return (
        MIN_LONGITUDE <= longitude <= MAX_LONGITUDE
        and MIN_LATITUDE <= latitude <= MAX_LATITUDE
    )


def write_document(path: Path, document: dict[str, Any]) -> None:
    validate_document(document)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def validate_document(document: dict[str, Any]) -> None:
    required = (
        "schema_version",
        "dataset_id",
        "snapshot_at",
        "source_url",
        "source_sha256",
        "attribution",
        "entries",
    )
    if any(not document.get(key) for key in required):
        raise BuildError("output metadata is incomplete")
    if not isinstance(document["entries"], list):
        raise BuildError("output entries must be an array")


if __name__ == "__main__":
    raise SystemExit(main())
