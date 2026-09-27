import 'package:flutter/material.dart';
import '../data/map_bridge.dart';
import 'sync_status_screen.dart';
import 'government_sync_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({
    super.key,
    required this.themeMode,
    required this.animationEnabled,
    required this.onThemeModeChanged,
    required this.onAnimationChanged,
    this.bridge,
  });

  final ThemeMode themeMode;
  final bool animationEnabled;
  final ValueChanged<ThemeMode> onThemeModeChanged;
  final ValueChanged<bool> onAnimationChanged;
  final MapBridge? bridge;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('個人設定')),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: <Widget>[
        Card(
          child: ListTile(
            leading: const Icon(Icons.cloud_download_outlined),
            title: const Text('政府資料更新'),
            subtitle: const Text('取得最新警報與道路、收容所狀態'),
            trailing: const Icon(Icons.chevron_right),
            onTap:
                () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder:
                        (_) =>
                            GovernmentSyncScreen(bridge: bridge ?? MapBridge()),
                  ),
                ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('同步狀態'),
            subtitle: const Text('查看緊急模式、附近節點與同步結果'),
            trailing: const Icon(Icons.chevron_right),
            onTap:
                () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder:
                        (_) => SyncStatusScreen(bridge: bridge ?? MapBridge()),
                  ),
                ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('偏好設定', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: '繁體中文',
                  decoration: const InputDecoration(labelText: '語言'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: '繁體中文', child: Text('繁體中文')),
                    DropdownMenuItem(value: 'English', child: Text('English')),
                  ],
                  onChanged: (_) {},
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<ThemeMode>(
                  value: themeMode,
                  decoration: const InputDecoration(labelText: '畫面主題'),
                  items: const <DropdownMenuItem<ThemeMode>>[
                    DropdownMenuItem(
                      value: ThemeMode.system,
                      child: Text('跟隨系統'),
                    ),
                    DropdownMenuItem(value: ThemeMode.light, child: Text('淺色')),
                    DropdownMenuItem(value: ThemeMode.dark, child: Text('深色')),
                  ],
                  onChanged: (value) {
                    if (value != null) onThemeModeChanged(value);
                  },
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('事件動畫'),
                  subtitle: const Text('新事件以短暫脈動提醒'),
                  value: animationEnabled,
                  onChanged: onAnimationChanged,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            leading: const Icon(Icons.offline_bolt_outlined),
            title: const Text('離線資料說明'),
            subtitle: const Text('內湖道路、避難所與醫療院所使用版本化快照。'),
          ),
        ),
      ],
    ),
  );
}
