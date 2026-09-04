## Stage 0 進度記錄：單機 BLE Discovery 驗證（2026-09-04）

### 環境

- 廣播端：Samsung SM-S731B（Android 16, API 36.1），實機，未使用模擬器
- 觀察端：Windows PC，內建藍牙介面卡，未使用額外硬體（如 Nordic USB dongle）
- 工具：
  - Android Studio（編譯、安裝、Logcat）
  - Microsoft Store：Bluetooth LE Explorer（Windows 端 BLE 掃描工具）

### 操作過程

1. 在 `com.resilientgeo.mesh.transport` 套件下新增 `PeerTransport.kt`（平台無關傳輸層介面）、`BleDiscovery.kt`（BLE 廣播 + 掃描實作）、`BleSpikeActivity.kt`（處理執行期權限、啟動廣播與掃描的測試用 Activity）。
2. `AndroidManifest.xml` 加入 `BLUETOOTH_SCAN`、`BLUETOOTH_ADVERTISE`、`BLUETOOTH_CONNECT`、`ACCESS_FINE_LOCATION` 權限，並將 `BleSpikeActivity` 設為 `LAUNCHER` Activity。
3. `app/build.gradle.kts` 加入 `kotlinx-coroutines-android` 依賴。
4. 手機端開啟開發人員選項、USB 偵錯，USB 連接模式選擇「已連接裝置」，安裝並執行 App，於彈出視窗中授權 BLE 相關執行期權限。
5. 透過 Android Studio Logcat 篩選 `tag:ResilientGeoBle message:advertise`，確認印出 `advertise started ok`，代表廣播端程式碼執行成功。
6. Windows 端安裝 Bluetooth LE Explorer，於 **Advertisement Monitor** 頁面掃描附近裝置，逐筆比對 `Section Type` 是否為 `CompleteService128BitUuids (07)`。
7. 找到地址 `4CF04FB098A1` 的裝置，其 `Section Data` 反轉位元組後與程式碼設定的 `8f6a1c00-0000-4000-8000-00805f9b34fb` 一致，且該地址於 15:34、15:46、15:50 三個時間點皆重複出現，確認廣播持續穩定。
8. 截圖保存欄位解析結果作為佐證（`docs/adr/evidence/ble-advertisement-2026-09-04.png`）。

### 驗證結果

- ✅ BLE 廣播（advertise）程式碼可在實機正確啟動並持續運作
- ✅ 廣播內容可被非 Android、非我方程式碼的通用 BLE 工具（Windows 內建藍牙）正確解析出自訂 Service UUID
- ✅ `Advertisement Type: ConnectableUndirected` 符合 `setConnectable(true)` 設定
- ⚠️ 尚未驗證：BLE 掃描端（我方程式碼）能否反向偵測到另一台跑相同程式碼的 Android 裝置（因目前僅有一台實機）
- ⚠️ 尚未驗證：Nearby Connections、Wi-Fi Direct 的 connect / send / resume，以及 1MB／10MB 吞吐量、斷線續傳

### 給下一位接手者（或未來的自己）的待辦

1. **借到第二台 Android 實機後**，兩台裝置都跑 `BleSpikeActivity`，驗證雙向 discovery：A 掃描端能否看到 B 廣播、B 掃描端能否看到 A 廣播，記錄 discovery latency（p50/p95）。
2. 在 `PeerTransport.kt` 介面下新增 Nearby Connections 的實作類別（例如 `NearbyConnectionsTransport.kt`），實作 `connect()`、`send()`、`resume()`、`close()`。
3. 用兩台實機測 1 MB、10 MB 檔案傳輸，記錄吞吐量（bytes/秒）。
4. 在傳輸進度 25%、50%、75% 時人為斷線，測試 `resume()` 能否從中斷點正確續傳。
5. 全部數據補齊後，將 ADR-001 最上方狀態欄由 `Proposed` 改為 `Accepted`，並在「未選方案與原因」段落補上實測依據，通知 B 可以開始依賴這個 transport 進行 Android UI 開發。