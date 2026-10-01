import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/widgets/startup_splash.dart';

void main() {
  testWidgets('startup splash shows the light phone loading artwork', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        darkTheme: ThemeData.dark(),
        themeMode: ThemeMode.light,
        home: const StartupSplash(),
      ),
    );

    final image = tester.widget<Image>(find.byType(Image));
    expect(
      (image.image as AssetImage).assetName,
      'assets/Geo_light_phone_logo.png',
    );
    expect(image.fit, BoxFit.cover);
  });

  testWidgets('startup splash shows the dark phone loading artwork', (
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
    expect(
      (image.image as AssetImage).assetName,
      'assets/Geo_dark_phone_logo.png',
    );
    expect(image.fit, BoxFit.cover);
  });
}
