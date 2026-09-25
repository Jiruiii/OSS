import 'package:flutter_test/flutter_test.dart';

import 'package:resilientgeo_flutter/theme/app_theme.dart';

void main() {
  test('light and dark themes use the bundled UI font', () {
    expect(AppTheme.light().textTheme.bodyMedium?.fontFamily, 'NotoSansTC');
    expect(AppTheme.dark().textTheme.bodyMedium?.fontFamily, 'NotoSansTC');
  });
}
