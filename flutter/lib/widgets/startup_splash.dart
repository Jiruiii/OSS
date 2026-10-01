import 'package:flutter/material.dart';

class StartupSplash extends StatelessWidget {
  const StartupSplash({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return SizedBox.expand(
      child: Image.asset(
        isDark
            ? 'assets/Geo_dark_phone_logo.png'
            : 'assets/Geo_light_phone_logo.png',
        fit: BoxFit.cover,
      ),
    );
  }
}
