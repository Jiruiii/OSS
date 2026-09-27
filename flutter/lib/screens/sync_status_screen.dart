import 'dart:async';
import 'package:flutter/material.dart';
import '../data/bridge_failure.dart';
import '../data/map_bridge.dart';
import '../data/sync_status.dart';

class SyncStatusScreen extends StatefulWidget {
  const SyncStatusScreen({super.key, required this.bridge});
  final MapBridge bridge;
  @override
  State<SyncStatusScreen> createState() => _SyncStatusScreenState();
}

class _SyncStatusScreenState extends State<SyncStatusScreen>
    with WidgetsBindingObserver {
  Timer? _timer;
  SyncStatus? _status;
  Object? _error;
  bool _loading = false, _changing = false, _foreground = true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_foreground) unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_loading || !mounted) return;
    setState(() => _loading = true);
    try {
      final status = await widget.bridge.getSyncStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setEnabled(bool enabled) async {
    if (_changing) return;
    setState(() => _changing = true);
    try {
      await widget.bridge.setEmergencyMode(enabled: enabled);
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _changing = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  String _time(DateTime? value) {
    if (value == null) return '尚無紀錄';
    final local = value.toLocal();
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${local.year}/${pad(local.month)}/${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}';
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    return Scaffold(
      appBar: AppBar(
        title: const Text('同步狀態'),
        actions: [
          IconButton(
            tooltip: '重新整理',
            onPressed: _loading ? null : _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_loading && status == null) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _error is BridgeFailure &&
                              (_error as BridgeFailure).code ==
                                  BridgeFailureCode.unavailable
                          ? '同步狀態需要 Android App；此環境僅供預覽'
                          : '無法取得同步狀態，請重新整理',
                    ),
                    if (status != null)
                      Text('以下為上次取得的狀態（${_time(status.observedAt)}）'),
                    TextButton(
                      onPressed: _loading ? null : _refresh,
                      child: const Text('重試'),
                    ),
                  ],
                ),
              ),
            ),
          if (status != null) ...[
            Card(
              child: Column(
                children: [
                  SwitchListTile(
                    title: const Text('緊急模式'),
                    subtitle: Text(
                      _error != null ? '狀態待重新確認' : status.activityLabel,
                    ),
                    value: status.emergencyModeEnabled,
                    onChanged: _changing || _error != null ? null : _setEnabled,
                  ),
                  ListTile(
                    title: const Text('藍牙'),
                    trailing: Text(
                      !status.bluetoothAvailable
                          ? '不支援'
                          : status.bluetoothEnabled
                          ? '已開啟'
                          : '已關閉',
                    ),
                  ),
                  ListTile(
                    title: const Text('附近裝置權限'),
                    trailing: Text(
                      status.blePermissionsGranted ? '已允許' : '未允許',
                    ),
                  ),
                  ListTile(
                    title: const Text('通知權限'),
                    trailing: Text(status.notificationsEnabled ? '已允許' : '未允許'),
                  ),
                  if (!status.blePermissionsGranted)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('重新開啟緊急模式以授予附近裝置權限；若已拒絕，請至系統 App 設定允許。'),
                    ),
                  if (!status.bluetoothEnabled && status.bluetoothAvailable)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('請在系統設定開啟藍牙，再重新開啟緊急模式。'),
                    ),
                  if (!status.notificationsEnabled)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('允許通知後，可在通知列查看緊急模式的運作狀態。'),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(
                children: [
                  const ListTile(title: Text('本次服務啟動期間')),
                  ListTile(
                    title: const Text('附近節點'),
                    trailing: Text('${status.nearbyPeers}'),
                  ),
                  ListTile(
                    title: const Text('進行中的連線'),
                    trailing: Text('${status.activeSessions}'),
                  ),
                  ListTile(
                    title: const Text('完成同步次數'),
                    trailing: Text('${status.syncCompletions}'),
                  ),
                  ListTile(
                    title: const Text('已接收並驗證的分片'),
                    trailing: Text('${status.chunksReceived}'),
                  ),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: Text('資料已一致時也會完成同步；完成次數不代表不同裝置數。'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ListTile(
                    title: const Text('最後成功同步'),
                    subtitle: Text(_time(status.lastSuccessAt)),
                  ),
                  ListTile(
                    title: const Text('最近一次失敗'),
                    subtitle: Text(
                      status.lastFailureAt == null
                          ? '尚無紀錄'
                          : '${status.failureDescription}\n${_time(status.lastFailureAt)}',
                    ),
                  ),
                  if (status.lastSuccessAt != null &&
                      status.lastFailureAt != null &&
                      status.lastSuccessAt!.isAfter(status.lastFailureAt!))
                    const Padding(
                      padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                      child: Text('此失敗之後已有成功同步紀錄。'),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
