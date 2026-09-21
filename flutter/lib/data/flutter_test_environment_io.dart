import 'dart:io';

final bool isFlutterTestEnvironment = Platform.environment.containsKey(
  'FLUTTER_TEST',
);
