import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/map_runtime_state.dart';
import 'package:resilientgeo_flutter/widgets/map_canvas.dart';
import 'package:resilientgeo_flutter/widgets/map_zoom_controls.dart';

void main() {
  test('online configured Google preference selects Google renderer', () {
    expect(
      MapCanvas.resolveProvider(
        requestedMode: MapProviderMode.googleOnline,
        configuredGoogleMapsKey: 'demo-key',
        networkAvailable: true,
      ),
      MapProviderMode.googleOnline,
    );
  });

  test('missing key or network selects offline renderer', () {
    expect(
      MapCanvas.resolveProvider(
        requestedMode: MapProviderMode.googleOnline,
        configuredGoogleMapsKey: '',
        networkAvailable: true,
      ),
      MapProviderMode.offline,
    );
    expect(
      MapCanvas.resolveProvider(
        requestedMode: MapProviderMode.googleOnline,
        configuredGoogleMapsKey: 'demo-key',
        networkAvailable: false,
      ),
      MapProviderMode.offline,
    );
  });

  testWidgets('percentage control exposes 0, 50, and 100 percent', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MapZoomControls(
            zoomPercentage: 0,
            onZoomPercentageChanged: (_) {},
          ),
        ),
      ),
    );
    expect(find.text('縮放 0%'), findsOneWidget);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MapZoomControls(
            zoomPercentage: 50,
            onZoomPercentageChanged: (_) {},
          ),
        ),
      ),
    );
    expect(find.text('縮放 50%'), findsOneWidget);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MapZoomControls(
            zoomPercentage: 100,
            onZoomPercentageChanged: (_) {},
          ),
        ),
      ),
    );
    expect(find.text('縮放 100%'), findsOneWidget);
  });

  testWidgets('plus and minus controls change the displayed percentage', (
    tester,
  ) async {
    var percentage = 50;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder:
                (context, setState) => MapZoomControls(
                  zoomPercentage: percentage,
                  onZoomPercentageChanged: (value) {
                    setState(() => percentage = value);
                  },
                ),
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('放大'));
    await tester.pump();
    expect(find.text('縮放 60%'), findsOneWidget);

    await tester.tap(find.byTooltip('縮小'));
    await tester.pump();
    expect(find.text('縮放 50%'), findsOneWidget);
  });
}
