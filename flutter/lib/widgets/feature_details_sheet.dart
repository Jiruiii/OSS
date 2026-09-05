import 'package:flutter/material.dart';

import '../data/map_models.dart';
import 'map_layers.dart';

class FeatureDetailsSheet extends StatelessWidget {
  const FeatureDetailsSheet.feature({
    super.key,
    required StaticFeature feature,
    required this.snapshotAt,
    required this.onClose,
  }) : _feature = feature,
       _event = null;

  const FeatureDetailsSheet.event({
    super.key,
    required MeshEvent event,
    required this.onClose,
  }) : _event = event,
       _feature = null,
       snapshotAt = null;

  final StaticFeature? _feature;
  final MeshEvent? _event;
  final String? snapshotAt;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final body =
        _feature != null ? _featureBody(_feature!) : _eventBody(_event!);
    final title =
        _feature != null ? featureName(_feature!) : eventName(_event!);
    return Material(
      color: Theme.of(context).colorScheme.surface,
      elevation: 12,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 12, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Center(
                child: Container(
                  height: 4,
                  width: 36,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    tooltip: '關閉詳情',
                    onPressed: onClose,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              ...body,
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _featureBody(StaticFeature feature) {
    final details = feature.details;
    final kind = feature.kind;
    if (kind == 'shelter') {
      return <Widget>[
        _DetailLine('地址', _text(details['address'])),
        _DetailLine('預計收容人數', '${_text(details['capacity'])}人'),
        const _DetailLine('目前收容人數', '無資料'),
        _DetailLine('適用災害類別', _listText(details['disaster_types'])),
      ];
    }
    if (kind == 'medical') {
      return <Widget>[
        _DetailLine('類型', _text(details['facility_type'])),
        _DetailLine('地址', _text(details['address'])),
        _DetailLine('來源', _text(details['source'])),
        _DetailLine('快照', _text(snapshotAt)),
      ];
    }
    return <Widget>[
      _DetailLine('類型', _text(kind)),
      _DetailLine('來源', _text(details['source'])),
    ];
  }

  List<Widget> _eventBody(MeshEvent event) => <Widget>[
    _DetailLine('事件類型', _text(event.eventType)),
    _DetailLine('嚴重度', _text(event.severity)),
    _DetailLine('來源', _text(event.source)),
    _DetailLine('發佈時間', _text(event.issuedAt)),
    _DetailLine('到期時間', _text(event.expiresAt)),
    if (event.isExpired) const _DetailLine('狀態', '已過期'),
  ];
}

class _DetailLine extends StatelessWidget {
  const _DetailLine(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Text('$label：$value'),
  );
}

String _text(Object? value) {
  if (value == null) return '無資料';
  if (value is String && value.isEmpty) return '無資料';
  return value.toString();
}

String _listText(Object? value) {
  if (value is List) {
    final values = value.whereType<String>().where((item) => item.isNotEmpty);
    return values.isEmpty ? '無資料' : values.join('、');
  }
  return _text(value);
}
