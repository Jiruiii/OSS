import 'package:flutter/material.dart';

import 'screens/map_screen.dart';

void main() => runApp(const ResilientGeoApp());

class ResilientGeoApp extends StatelessWidget {
  const ResilientGeoApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF006C63)),
      useMaterial3: true,
    ),
    home: const MapScreen(),
  );
}
