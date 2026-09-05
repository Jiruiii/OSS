import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BBOX = [121.5519933, 25.0518603, 121.6286149, 25.1151519]
SNAPSHOT_AT = "2026-09-04T17:58:15.942Z"
EXPECTED_Z12_TILES = {
    (12, 3430, 1752),
    (12, 3430, 1753),
    (12, 3431, 1752),
    (12, 3431, 1753),
}


def valid_display_fixture():
    features = []
    for index in range(5774):
        offset = (index % 97) * 0.00001
        features.append(
            {
                "id": f"osm:way:{index}",
                "kind": "ROAD",
                "source": "osm-neihu",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [121.57 + offset, 25.07 + offset],
                        [121.571 + offset, 25.071 + offset],
                    ],
                },
                "properties": {"name": None, "road_class": "residential"},
            }
        )
    for index in range(26):
        features.append(
            {
                "id": f"shelter:{index}",
                "kind": "SHELTER",
                "source": "taipei-shelter",
                "geometry": {"type": "Point", "coordinates": [121.58, 25.08]},
                "properties": {
                    "name": f"Shelter {index}",
                    "address": "Neihu",
                    "capacity": index + 1,
                    "available_count": None,
                },
            }
        )
    for index in range(4):
        features.append(
            {
                "id": f"medical:{index}",
                "kind": "MEDICAL_FACILITY",
                "source": "taipei-medical",
                "geometry": {"type": "Point", "coordinates": [121.59, 25.08]},
                "properties": {"name": f"Medical {index}", "address": "Neihu"},
            }
        )
    return {
        "schema_version": "offline-map-display-v1",
        "dataset_id": "resilientgeo-neihu",
        "snapshot_at": SNAPSHOT_AT,
        "bounds": BBOX,
        "sources": [
            {
                "source_id": "osm-neihu",
                "snapshot_at": SNAPSHOT_AT,
                "attribution": "© OpenStreetMap contributors",
                "attribution_url": "https://www.openstreetmap.org/copyright",
            }
        ],
        "features": features,
    }


class NeihuOfflineMapAssetTests(unittest.TestCase):
    def build_assets(self, temp_dir):
        fixture_path = temp_dir / "offline-map-display-v1.json"
        static_path = temp_dir / "flutter" / "assets" / "data" / "neihu" / "static-features.json"
        tile_root = temp_dir / "flutter" / "assets" / "map" / "tiles"
        fixture_path.write_text(
            json.dumps(valid_display_fixture(), ensure_ascii=False), encoding="utf-8"
        )
        command = [
            sys.executable,
            "tools/build-neihu-offline-tiles.py",
            "--fixture",
            str(fixture_path),
            "--static-output",
            str(static_path),
            "--tile-root",
            str(tile_root),
            "--min-zoom",
            "12",
            "--max-zoom",
            "12",
        ]
        completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return fixture_path, static_path, tile_root

    def validate_assets(self, fixture_path, static_path, tile_root):
        command = [
            sys.executable,
            "tools/validate-neihu-map-assets.py",
            "--fixture",
            str(fixture_path),
            "--static-features",
            str(static_path),
            "--tile-root",
            str(tile_root),
            "--min-zoom",
            "12",
            "--max-zoom",
            "12",
        ]
        return subprocess.run(command, cwd=ROOT, capture_output=True, text=True)

    def test_builder_writes_static_asset_and_all_intersecting_tiles_from_fixture_only(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture_path, static_path, tile_root = self.build_assets(Path(directory))
            self.assertEqual(
                json.loads(static_path.read_text(encoding="utf-8")),
                json.loads(fixture_path.read_text(encoding="utf-8")),
            )
            expected_paths = {
                tile_root / str(z) / str(x) / f"{y}.png"
                for z, x, y in EXPECTED_Z12_TILES
            }
            self.assertEqual({path for path in tile_root.rglob("*.png")}, expected_paths)
            validation = self.validate_assets(fixture_path, static_path, tile_root)
            self.assertEqual(validation.returncode, 0, validation.stderr)

    def test_validator_rejects_a_shelter_available_count_other_than_null(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture_path, static_path, tile_root = self.build_assets(Path(directory))
            runtime_document = json.loads(static_path.read_text(encoding="utf-8"))
            next(
                feature for feature in runtime_document["features"] if feature["kind"] == "SHELTER"
            )["properties"]["available_count"] = 0
            static_path.write_text(
                json.dumps(runtime_document, ensure_ascii=False), encoding="utf-8"
            )
            validation = self.validate_assets(fixture_path, static_path, tile_root)
            self.assertNotEqual(validation.returncode, 0)
            self.assertIn("available_count", validation.stderr)


if __name__ == "__main__":
    unittest.main()
