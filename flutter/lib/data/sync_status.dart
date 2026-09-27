final class SyncStatus {
  const SyncStatus({
    required this.emergencyModeEnabled,
    required this.bluetoothAvailable,
    required this.bluetoothEnabled,
    required this.blePermissionsGranted,
    required this.notificationsEnabled,
    required this.serviceRunning,
    required this.discoveryActive,
    required this.nearbyPeers,
    required this.activeSessions,
    required this.syncCompletions,
    required this.chunksReceived,
    required this.observedAt,
    this.lastSuccessAt,
    this.lastFailureAt,
    this.lastFailureCode,
  });

  final bool emergencyModeEnabled,
      bluetoothAvailable,
      bluetoothEnabled,
      blePermissionsGranted,
      notificationsEnabled,
      serviceRunning,
      discoveryActive;
  final int nearbyPeers, activeSessions, syncCompletions, chunksReceived;
  final DateTime observedAt;
  final DateTime? lastSuccessAt, lastFailureAt;
  final String? lastFailureCode;

  factory SyncStatus.fromMessage(Map<String, dynamic> message) {
    bool flag(String key) {
      final value = message[key];
      if (value is! bool) throw FormatException('Invalid sync status: $key');
      return value;
    }

    int count(String key) {
      final value = message[key];
      if (value is! int || value < 0) {
        throw FormatException('Invalid sync status: $key');
      }
      return value;
    }

    DateTime? timestamp(String key) {
      final value = message[key];
      if (value == null) return null;
      final parsed = value is String ? DateTime.tryParse(value) : null;
      if (parsed == null) throw FormatException('Invalid sync status: $key');
      return parsed;
    }

    final observed = timestamp('observed_at');
    if (observed == null) {
      throw const FormatException('Missing sync observation time');
    }
    final code = message['last_failure_code'];
    if (code != null && code is! String) {
      throw const FormatException('Invalid sync failure code');
    }
    return SyncStatus(
      emergencyModeEnabled: flag('emergency_mode_enabled'),
      bluetoothAvailable: flag('bluetooth_available'),
      bluetoothEnabled: flag('bluetooth_enabled'),
      blePermissionsGranted: flag('ble_permissions_granted'),
      notificationsEnabled: flag('notifications_enabled'),
      serviceRunning: flag('service_running'),
      discoveryActive: flag('discovery_active'),
      nearbyPeers: count('nearby_peers'),
      activeSessions: count('active_sessions'),
      syncCompletions: count('sync_completions'),
      chunksReceived: count('chunks_received'),
      observedAt: observed,
      lastSuccessAt: timestamp('last_success_at'),
      lastFailureAt: timestamp('last_failure_at'),
      lastFailureCode: code as String?,
    );
  }

  String get activityLabel {
    if (!emergencyModeEnabled) return '緊急模式未開啟';
    if (!bluetoothAvailable) return '裝置不支援藍牙';
    if (!blePermissionsGranted) return '尚未取得附近裝置權限';
    if (!bluetoothEnabled) return '請開啟藍牙';
    if (!serviceRunning) return '尚未確認服務運作，請重新開啟緊急模式';
    if (!discoveryActive) {
      return lastFailureCode == 'discovery_failed'
          ? '搜尋失敗，請重新開啟緊急模式'
          : '服務已啟動，尚未開始搜尋';
    }
    if (activeSessions > 0) return '正在與附近節點同步';
    return nearbyPeers > 0 ? '正在搜尋，附近有可同步節點' : '正在搜尋附近節點';
  }

  String get failureDescription => switch (lastFailureCode) {
    'connection_failed' => '藍牙連線未成功或已逾時',
    'hello_timeout' => '對方未在時間內回應資料摘要',
    'send_failed' => '藍牙訊息傳送失敗',
    'transfer_incomplete' => '需要的資料未收齊，或資料驗證未通過',
    'session_failed' => '同步過程中發生錯誤',
    'discovery_failed' => '無法搜尋附近節點',
    'message_invalid' => '收到無法讀取的同步訊息',
    _ => '同步未完成',
  };
}
