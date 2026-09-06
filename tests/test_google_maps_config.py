import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GoogleMapsConfigurationTests(unittest.TestCase):
    def test_flutter_dependencies_are_pinned_for_the_demo(self) -> None:
        pubspec = (ROOT / "flutter/pubspec.yaml").read_text(encoding="utf-8")

        self.assertIn("google_maps_flutter: 2.14.0", pubspec)
        self.assertIn("connectivity_plus: 6.1.4", pubspec)
        self.assertIn("geolocator: 13.0.2", pubspec)
        self.assertIn("shared_preferences: 2.5.3", pubspec)

    def test_android_key_is_injected_without_being_committed(self) -> None:
        gradle = (ROOT / "android/app/build.gradle.kts").read_text(encoding="utf-8")
        manifest = (ROOT / "android/app/src/main/AndroidManifest.xml").read_text(
            encoding="utf-8"
        )
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

        self.assertIn('System.getenv("GOOGLE_MAPS_API_KEY")', gradle)
        self.assertIn("local.properties", gradle)
        self.assertIn('manifestPlaceholders["GOOGLE_MAPS_API_KEY"]', gradle)
        self.assertRegex(
            gradle,
            r'System\.getenv\("GOOGLE_MAPS_API_KEY"\)[\s\S]*\?: '
            r'localProperties\.getProperty\("GOOGLE_MAPS_API_KEY"\)',
        )
        self.assertIn('android:name="com.google.android.geo.API_KEY"', manifest)
        self.assertIn('android:value="${GOOGLE_MAPS_API_KEY}"', manifest)
        self.assertIn('android:name="android.permission.INTERNET"', manifest)
        self.assertIn('android:name="android.permission.ACCESS_COARSE_LOCATION"', manifest)
        self.assertIn('android:name="android.permission.ACCESS_FINE_LOCATION"', manifest)
        self.assertIn("/android/local.properties", gitignore)

        for path in (
            ROOT / "android/app/build.gradle.kts",
            ROOT / "android/app/src/main/AndroidManifest.xml",
            ROOT / "flutter/pubspec.yaml",
        ):
            self.assertIsNone(
                re.search(r"AIza[0-9A-Za-z_-]{20,}", path.read_text(encoding="utf-8")),
                f"Google API key must not be committed to {path.relative_to(ROOT)}",
            )

    def test_google_map_styles_are_local_nonempty_json_without_map_id(self) -> None:
        for filename in ("google-map-light.json", "google-map-dark.json"):
            path = ROOT / "flutter/assets/map" / filename
            contents = path.read_text(encoding="utf-8").strip()
            self.assertTrue(contents, f"{filename} must not be empty")
            self.assertIsInstance(json.loads(contents), list)
            self.assertNotIn("mapId", contents)
            self.assertNotIn("map_id", contents)


if __name__ == "__main__":
    unittest.main()
