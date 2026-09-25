import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/widgets/startup_splash.dart';

void main() {
  test('bundles both phone splash logo variants', () async {
    final light = await rootBundle.load(StartupLogoAssets.lightPhone);
    final dark = await rootBundle.load(StartupLogoAssets.darkPhone);

    expect(light.lengthInBytes, greaterThan(0));
    expect(dark.lengthInBytes, greaterThan(0));
  });

  test('selects the phone logo for the effective system brightness', () {
    expect(
      StartupLogoAssets.phoneFor(Brightness.light),
      StartupLogoAssets.lightPhone,
    );
    expect(
      StartupLogoAssets.phoneFor(Brightness.dark),
      StartupLogoAssets.darkPhone,
    );
  });

  testWidgets('startup splash renders the effective theme logo', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        darkTheme: ThemeData.dark(),
        themeMode: ThemeMode.dark,
        home: const StartupSplash(),
      ),
    );

    final image = tester.widget<Image>(find.byType(Image));
    expect((image.image as AssetImage).assetName, StartupLogoAssets.darkPhone);
  });
}
