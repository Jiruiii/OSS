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

---

## Stage 0 進度記錄：雙機 BLE Discovery 驗證（2026-09-04，同日第二次）

### 環境

- 兩台實機：Pixel 7（`2A221FDH2004RL`，API 37）、Pixel 8a（`41051JEKB12762`，API 37），皆透過 USB 接同一台電腦
- 全程用 `adb`（`pm grant` 授權限、`svc bluetooth enable`、`am start`/`force-stop`、`logcat`）驅動測試，沒有手動點裝置畫面

### 過程與發現的 bug

1. 第一輪測試（未過濾 scan）：兩台裝置各自量到的 latency 是 85 秒與 133 秒等級，且 Pixel 7 那輪中途換了兩個不同的來源 MAC——不合理。回頭檢查 `BleDiscovery.startScanning()` 發現 `scanner.startScan(null, settings, callback)` 沒有帶 `ScanFilter`，等於掃到附近所有 BLE 裝置（耳機、手錶等環境雜訊），不是彼此的廣播。
2. 修正：加上 `ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()`，只保留符合我們 Service UUID 的結果（`transport/BleDiscovery.kt`）。
3. 也同時把 `BleSpikeActivity` 加上畫面顯示（peer id／RSSI／latency）跟「Restart scan」按鈕，並把 latency 用 `DISCOVERY_LATENCY` 結構化 log 印出，方便重跑多次與事後用 `adb logcat` 撈數字。

### 驗證結果

修正後重跑，兩台裝置各自穩定只看到對方那一個 MAC（不再飄移），5 次亮屏試驗：

- Pixel 7：246 / 419 / 531 / 536 / 540 ms → p50 = 531ms，p95 ≈ 540ms
- Pixel 8a：99 / 104 / 114 / 142 / 283 ms → p50 = 114ms，p95 ≈ 283ms

另外把 Pixel 7 螢幕鎖屏（確認 `dumpsys power` 顯示 `mWakefulness=Dozing`），鎖屏後 15 秒內雙方仍持續收到彼此廣播，沒有立即被系統掛掉——但只驗證了 15 秒，沒有測到 Doze 模式介入後的長時間行為。

- ✅ 雙向 discovery 已驗證：A 能看到 B、B 能看到 A
- ✅ Discovery latency 數據已補進 ADR-001（含 p50/p95）
- ✅ 短時間（15 秒）鎖屏後 discovery 仍運作
- ⚠️ 只有兩台裝置皆為 Pixel、同 API 37，未滿足「至少兩個品牌、兩個版本」
- ⚠️ 長時間背景／Doze 行為未測
- ⚠️ Nearby Connections connect/send/resume、1MB/10MB 吞吐量仍未開始

詳細數據與方法論見 `docs/adr/ADR-001-transport-layer.md` 的「實測記錄」段落。下一步：實作 `NearbyConnectionsTransport.kt`（見該檔案待辦），並找一台非 Pixel 或不同 Android 版本的裝置補相容性測試。

---

## Stage 0 定案：三個候選實機比較，採用 BLE GATT（2026-09-05）

同一晚把 ADR-001 列出的候選全部在 Pixel 7 + Pixel 8a 上實測過一輪，過程濃縮記錄在這裡，完整數據跟否決理由在 ADR-001。

### Nearby Connections — 否決

`NearbyConnectionsTransport.kt` 寫完、能編譯，但兩台裝置的 `startAdvertising()`/`startDiscovery()` 執行期都立即回傳 `ApiException: 8: INTERNAL_ERROR`。換了兩個 client library 版本（19.0.0、19.3.0）結果一樣——後來發現 stack trace 裡實際執行的是 GMS 自己動態載入的模組（版本跟我們宣告的不同），代表問題完全在 Google 的 on-device 模組內，不是我們能修的。症狀跟 2023 年一次已知的 Google 側 regression 完全一致（見 ADR-001 附的 issue 連結）。

### 原生 Wi-Fi Direct — 否決

`WifiDirectTransport.kt` 用平台原生 API，過程修好兩個真 bug（GO 端不會透過自己的 discovery 看到已連線的 client；`ServerSocket` 預設 IPv6 wildcard bind 沒對準實際 IPv4 位址）。修完後用系統原生設定手動連線成功、ping 通、`netstat` 確認 socket 正確監聽中——但 TCP 連線持續 timeout。這個組合（ICMP 通、socket 確認監聽、TCP 就是進不去）不像應用層能修的問題，懷疑是 Android 對多網路情境下 App socket 路由的限制，需要 root 權限才能進一步確認，時間壓力下沒有繼續排查。

### BLE GATT — 採用

重用已經驗證穩定的 BLE advertise/scan，加一組自訂 GATT service（WRITE characteristic 傳資料、NOTIFY characteristic 回 ACK），兩台裝置同時身兼 Peripheral（接收）與 Central（發送）。自動化測試序列（10KB → 100KB → 中斷於 ~1020 bytes → 續傳）**兩台裝置互傳全部成功**：

- 10KB：Pixel 7 3181ms（3.2 KB/s）、Pixel 8a 2130ms（4.8 KB/s）
- 100KB：Pixel 7 25331ms（4.0 KB/s）、Pixel 8a 17422ms（5.9 KB/s）
- 中斷續傳：兩台都在 1020 bytes 處中斷，續傳成功，且確認是真的位元組級續傳（不是重傳整包）

過程修好一個協定層 bug：ATT_MTU 協商到 517 後算出的 payload room（514 bytes）超過 BLE 規格對單一 attribute value 的 512 bytes 硬上限，導致 `writeCharacteristic()` 丟例外；改成 `coerceIn(20, 512)` 修正。

**結論**：discovery、連線、傳輸、斷點續傳全部驗證通過，不依賴 Wi-Fi 也不依賴 Google Play Services。ADR-001 狀態定案為 `Accepted（BLE GATT）`。吞吐量（3–6 KB/s）遠低於 Wi-Fi 類方案，但本專案實際酬載是 KB 級事件記錄，不是 MB 級檔案，這個吞吐量是夠用的。

### 給下一位接手者的待辦

1. 裝置相容性：目前只測過兩台 Pixel、同一 API 版本，還缺至少一個非 Pixel 或不同 Android 版本的裝置
2. Connection success rate（20 次連線，分亮屏／鎖屏）、Energy 量測都還沒做
3. 把 HELLO/DIFF/REQUEST 協定接到 `BleGattTransport` 上——目前 `send`/`resume` 走的是 Stage 0 spike 用的隨機測試 payload，還沒接上真正的 chunk 資料與 `EventIngestor`
4. 階段 3：Peer 上限、critical-first 排程、三機 Store-Carry-Forward