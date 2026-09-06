import 'package:flutter/material.dart';

import 'app/map_app_controller.dart';
import 'screens/map_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/profile_screen.dart';
import 'widgets/app_bottom_navigation.dart';

void main() => runApp(const ResilientGeoApp());

class ResilientGeoApp extends StatefulWidget {
  const ResilientGeoApp({super.key});

  @override
  State<ResilientGeoApp> createState() => _ResilientGeoAppState();
}

class _ResilientGeoAppState extends State<ResilientGeoApp> {
  late final MapAppController _controller;

  @override
  void initState() {
    super.initState();
    _controller = MapAppController()..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) => MaterialApp(
      debugShowCheckedModeBanner: false,
      themeMode: _controller.themeMode,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: _MapAppHome(controller: _controller),
    ),
  );
}

ThemeData _theme(Brightness brightness) => ThemeData(
  brightness: brightness,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF006C63),
    brightness: brightness,
  ),
  useMaterial3: true,
);

class _MapAppHome extends StatefulWidget {
  const _MapAppHome({required this.controller});

  final MapAppController controller;

  @override
  State<_MapAppHome> createState() => _MapAppHomeState();
}

class _MapAppHomeState extends State<_MapAppHome> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    if (controller.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (controller.staticFeatures == null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              '無法載入內湖地圖資料\n${controller.loadError ?? '無資料'}',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: <Widget>[
          MapScreen(
            key: const ValueKey<String>('home-map'),
            staticFeatures: controller.staticFeatures,
            demoEvents: controller.demoEvents,
            initialState: controller.initialState,
            bridge: controller.bridge,
            eventUpdates: controller.eventUpdates,
            networkAvailable: controller.networkAvailable,
            // The Android host owns the real key in its manifest. Passing a
            // non-secret marker here enables Google only after the native
            // bridge confirms that manifest entry exists.
            configuredGoogleMapsKey: controller.googleMapsConfigured
                ? 'android-manifest-key'
                : '',
            themeMode: controller.themeMode,
            animationEnabled: controller.animationEnabled,
          ),
          NotificationsScreen(events: controller.events),
          ProfileScreen(
            themeMode: controller.themeMode,
            animationEnabled: controller.animationEnabled,
            onThemeModeChanged: controller.setThemeMode,
            onAnimationChanged: controller.setAnimationEnabled,
          ),
        ],
      ),
      bottomNavigationBar: AppBottomNavigation(
        currentIndex: _selectedIndex,
        notificationCount: controller.notificationCount,
        onSelected: (index) => setState(() => _selectedIndex = index),
      ),
    );
  }
}
