import 'package:flutter/material.dart';

/// Full-screen phone artwork shown while the Flutter app loads its offline
/// data and map assets.
class StartupLogoAssets {
  const StartupLogoAssets._();

  static const String lightPhone = 'assets/Geo_light_phone_logo.png';
  static const String darkPhone = 'assets/Geo_dark_phone_logo.png';

  static String phoneFor(Brightness brightness) =>
      brightness == Brightness.dark ? darkPhone : lightPhone;
}

class StartupSplash extends StatelessWidget {
  const StartupSplash({super.key});

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    return ColoredBox(
      color:
          brightness == Brightness.dark
              ? const Color(0xFF020B18)
              : const Color(0xFFF8FCFF),
      child: SizedBox.expand(
        child: Image.asset(
          StartupLogoAssets.phoneFor(brightness),
          fit: BoxFit.cover,
          semanticLabel: 'Resilient Geo Mesh',
        ),
      ),
    );
  }
}
