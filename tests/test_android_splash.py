import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AndroidSplashContractTests(unittest.TestCase):
    def test_android_host_uses_the_shared_logo_for_native_splash(self):
        gradle = (ROOT / "android/app/build.gradle.kts").read_text()
        versions = (ROOT / "android/gradle/libs.versions.toml").read_text()
        themes = (ROOT / "android/app/src/main/res/values/themes.xml").read_text()
        activity = (
            ROOT
            / "android/app/src/main/java/com/resilientgeo/mesh/MainActivity.kt"
        ).read_text()

        self.assertIn("core-splashscreen", versions)
        self.assertIn("copySplashLogo", gradle)
        self.assertIn('from(project.file("../../flutter/assets/Logo.png"))', gradle)
        self.assertIn("Theme.SplashScreen", themes)
        self.assertIn("windowSplashScreenAnimatedIcon", themes)
        self.assertIn("installSplashScreen()", activity)
        self.assertTrue((ROOT / "flutter/assets/Logo.png").stat().st_size > 0)


if __name__ == "__main__":
    unittest.main()
