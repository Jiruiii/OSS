import 'flutter_test_environment_stub.dart'
    if (dart.library.io) 'flutter_test_environment_io.dart';

/// Whether the widget tree is being exercised by `flutter test`.
///
/// Platform views are intentionally replaced by the desktop preview surface
/// in widget tests. Device and Chrome runs still use the real MapLibre view.
bool get isFlutterTest => isFlutterTestEnvironment;
