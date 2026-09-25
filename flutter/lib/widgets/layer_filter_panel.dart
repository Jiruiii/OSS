import 'package:flutter/material.dart';

class LayerFilterPanel extends StatelessWidget {
  const LayerFilterPanel({
    super.key,
    required this.showShelters,
    required this.showMedical,
    required this.showEvents,
    required this.emergencyModeEnabled,
    required this.onSheltersChanged,
    required this.onMedicalChanged,
    required this.onEventsChanged,
    required this.onEmergencyModeChanged,
  });

  final bool showShelters;
  final bool showMedical;
  final bool showEvents;
  final bool emergencyModeEnabled;
  final ValueChanged<bool> onSheltersChanged;
  final ValueChanged<bool> onMedicalChanged;
  final ValueChanged<bool> onEventsChanged;
  final ValueChanged<bool> onEmergencyModeChanged;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('圖層設定', style: Theme.of(context).textTheme.titleLarge),
            SwitchListTile(
              title: const Text('避難所'),
              value: showShelters,
              onChanged: onSheltersChanged,
            ),
            SwitchListTile(
              title: const Text('醫療院所'),
              value: showMedical,
              onChanged: onMedicalChanged,
            ),
            SwitchListTile(
              title: const Text('災情事件'),
              value: showEvents,
              onChanged: onEventsChanged,
            ),
            const Divider(),
            SwitchListTile(
              title: const Text('緊急模式'),
              value: emergencyModeEnabled,
              onChanged: onEmergencyModeChanged,
            ),
          ],
        ),
      ),
    ),
  );
}
