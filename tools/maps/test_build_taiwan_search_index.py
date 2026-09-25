import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "tools" / "maps" / "build_taiwan_search_index.py"
FIXTURE = ROOT / "tools" / "maps" / "testdata" / "taiwan-roads-fixture.json"


class BuildTaiwanSearchIndexTest(unittest.TestCase):
    def test_fixture_emits_sorted_named_roads_and_metadata(self):
        source_bytes = FIXTURE.read_bytes()
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "taiwan-roads.json"
            subprocess.run(
                [
                    sys.executable,
                    str(GENERATOR),
                    "--input-pbf",
                    str(FIXTURE),
                    "--source-date",
                    "2026-09-22",
                    "--source-url",
                    "https://example.test/taiwan-roads-fixture.json",
                    "--source-sha256",
                    source_sha256,
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                check=True,
            )

            document = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(document["source_sha256"], source_sha256)
        self.assertEqual(document["attribution"], "© OpenStreetMap contributors")
        entries = document["entries"]
        self.assertEqual([entry["name"] for entry in entries], ["中山路", "中山路", "和平街"])
        self.assertEqual([entry["region"] for entry in entries], ["臺北市", "高雄市", "臺中市"])
        taipei_entry = next(entry for entry in entries if entry["region"] == "臺北市")
        self.assertEqual(taipei_entry["coordinate"][0], 121.525)
        self.assertAlmostEqual(taipei_entry["coordinate"][1], 25.045)
        self.assertEqual(taipei_entry["aliases"], [])
        self.assertTrue(all(entry["kind"] == "road" for entry in entries))

    def test_declared_hash_mismatch_fails_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "taiwan-roads.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(GENERATOR),
                    "--input-pbf",
                    str(FIXTURE),
                    "--source-date",
                    "2026-09-22",
                    "--source-url",
                    "https://example.test/taiwan-roads-fixture.json",
                    "--source-sha256",
                    "0" * 64,
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())
        self.assertIn("SHA-256", result.stderr)


if __name__ == "__main__":
    unittest.main()
