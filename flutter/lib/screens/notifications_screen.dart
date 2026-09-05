import 'package:flutter/material.dart';

import '../data/map_models.dart';
import '../widgets/map_layers.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key, required this.events});

  final List<MeshEvent> events;

  @override
  Widget build(BuildContext context) {
    final sorted = List<MeshEvent>.of(events)
      ..sort((a, b) => (b.issuedAt ?? '').compareTo(a.issuedAt ?? ''));
    return Scaffold(
      appBar: AppBar(title: const Text('通知')),
      body: sorted.isEmpty
          ? const Center(child: Text('目前沒有事件通知'))
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              itemCount: sorted.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) => _EventCard(event: sorted[index]),
            ),
    );
  }
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event});

  final MeshEvent event;

  @override
  Widget build(BuildContext context) {
    final demo = event.namespace?.startsWith('demo') == true ||
        event.source?.toLowerCase() == 'demo';
    final title = eventName(event);
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: eventColor(event),
          child: Icon(
            event.isExpired ? Icons.schedule : Icons.warning_amber_rounded,
            color: Colors.white,
          ),
        ),
        title: Text(title),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            [
              if (demo) '模擬事件，非即時官方災情',
              '嚴重度：${event.severity ?? '無資料'}',
              '狀態：${event.isExpired ? '已過期' : '有效'}',
              '發布：${event.issuedAt ?? '無資料'}',
              '有效期限：${event.expiresAt ?? '無資料'}',
            ].join('\n'),
          ),
        ),
        isThreeLine: true,
      ),
    );
  }
}
