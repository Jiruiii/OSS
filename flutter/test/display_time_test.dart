import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/display_time.dart';

void main() {
  test('formats an ISO update time without leading zeros in date parts', () {
    expect(formatUpdateTime('2026-09-25T18:20:00Z'), '2026-9-25 18:20:00');
  });

  test('shows no data for a missing update time', () {
    expect(formatUpdateTime(null), '無資料');
    expect(formatUpdateTime(''), '無資料');
  });

  test('keeps an unparseable update time visible for diagnosis', () {
    expect(formatUpdateTime('not-a-time'), 'not-a-time');
  });
}
