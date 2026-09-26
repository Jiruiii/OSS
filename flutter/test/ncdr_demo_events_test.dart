import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/ncdr_demo_events.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loads the bundled nationwide NCDR snapshot', () async {
    final events = await const NcdrDemoEventLoader().load();

    expect(events, isNotEmpty);
    expect(events.every((event) => event.source == 'NCDR'), isTrue);
    expect(events.every((event) => event.namespace == 'official.ncdr'), isTrue);
    expect(events.every((event) => event.geometry != null), isTrue);
  });
}
