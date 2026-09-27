# 同步狀態與災害情境篩選（2026-09-27）

## 使用方式

- 個人設定 → 同步狀態，或地圖的圖層設定 → 同步狀態。此頁可啟停緊急模式，顯示藍牙、附近裝置權限、通知權限、服務狀態、附近節點與進行中的連線。
- 地圖上的「避難情境」按鈕 → 避難災害情境。提供不限類型、水災、震災、土石流、海嘯、核子事故、坡地災害六種資料類別；選擇影響推薦與手動路線規劃，不隱藏地圖上的設施。
- 指定情境後，明確不符合的避難所不納入推薦；資料缺漏或沒有可辨識類別的場所保留，但路線附上「無法確認適用」警告。不限類型維持原行為，沒有自動推斷災害。

## 資料與契約

新增 `getSyncStatus` MethodChannel 方法，回傳以下欄位：

| 欄位 | 說明 |
| --- | --- |
| `emergency_mode_enabled` | 使用者選擇，不等同服務已運作 |
| `bluetooth_available`、`bluetooth_enabled` | 藍牙支援與目前開關 |
| `ble_permissions_granted`、`notifications_enabled` | 目前權限 |
| `service_running`、`discovery_active` | 服務心跳與搜尋狀態 |
| `nearby_peers`、`active_sessions` | 約 30 秒內見過的節點與進行中的連線 |
| `sync_completions`、`chunks_received` | 本次服務啟動的成功同步次數與已驗證接收的分片數 |
| `last_success_at` | 跨 App 重啟保留的最後成功時間 |
| `last_failure_at`、`last_failure_code` | 跨重啟保留的最近失敗時間及分類 |
| `observed_at` | 此次讀取時間 |

成功次數包括「雙方已有相同資料」的核對，不代表不同裝置數。失敗紀錄保留，不因後續成功消失；介面會標明失敗之後已有成功。狀態不包含 MAC、節點身分或原始例外訊息。

服務每 5 秒更新統計；狀態頁前景每 3 秒讀取，背景停止輪詢，返回前景立即刷新。服務心跳超過 20 秒未更新視為未確認運作；程序死亡後不沿用上次的運作狀態或計數。讀取失敗時明確標示資料已舊，提供重試。

`calculateEvacuationRoute` 新增可選 `disaster_type`：`flood`、`earthquake`、`debris_flow`、`tsunami`、`nuclear`、`landslide`。省略時相容原有呼叫；未知字串回 `invalid_input`。Android 自己從已驗證的避難所圖層建立類別索引，不信任 Flutter 提供的適用性資訊。

| 路線警告碼 | 行為 |
| --- | --- |
| `SHELTER_DISASTER_MISMATCH` | `no_route`，明確類別不符 |
| `SHELTER_DISASTER_UNKNOWN` | 保留路線結果並標示類別不明 |
| `SHELTER_LOCATION_MISMATCH` | `invalid_input`，已知避難所 id 的座標與資料相差超過 1 公尺 |

災害情境只控制避難所適用類別；既有封路、危險區與開設狀態規則仍生效。路線不是官方疏散指示。

## 驗證

- Flutter：完整 248 項測試通過；最後狀態提示文字另跑 3 項狀態頁測試通過，analyze 無問題。
- Android JVM：141 項通過。涵蓋失敗／成功回報、搜尋失敗、心跳過期與停止後延遲更新、災害類別及座標核對。
- Pixel 8a、Sharp SH-M32：關閉 Wi-Fi 與行動數據後，各 2 項新增 instrumentation 通過。用真實簽章的潭美國小資料確認海嘯情境拒絕、水災可規劃、未知 id 附類別不明警告；隔離偏好設定驗證歷史保留與停止清除計數。
- 兩機 BLE 回歸：各 1 項通過，互補缺片及重建 transport 後不重傳已有資料仍成立。
- 正式畫面：兩機從個人設定進入同步頁、開啟緊急模式後都顯示附近節點 1、完成同步 1、最後成功時間。正式資料已一致，接收分片數為 0。關閉後計數歸零，強制結束 App 再開仍保留成功時間；Pixel 藍牙關閉的提示也已確認。
- 災害選擇：兩機均可從地圖進入選單、選擇震災，返回地圖顯示「避難情境：震災」。Flutter 操作測試另驗證此選擇確實排除水災專用候選並傳給原生路線方法；本輪未做 GPS 現場疏散演練。

本機原始記錄在 `.sim-out/`：`sync-disaster-full-tests-final.log`、`sync-disaster-analyze-final.log`、`sync-disaster-android-build-final.log`、各裝置 `*-sync-disaster-instrumentation.log`、`*-sync-status-peer-regression.log`、`*-sync-status-service.log`，以及 `*-sync-disaster-*.xml/json`。畫面截圖為 `pixel-sync-status-screen.png`、`sharp-sync-status-screen.png`。

新版以 `adb install -r` 覆蓋安裝，沒有清除 App 資料。測試完兩機緊急模式已關閉，恢復原有設定：Pixel 藍牙關閉、Wi-Fi 與行動數據開啟；Sharp 藍牙開啟、Wi-Fi 關閉、行動數據開啟。

## 尚待完成

同日後續已完成事件更新、到期與災害情境變更自動重算，詳見 [路線自動重算](automatic-route-refresh.md)。跨接觸續傳、長時間 Doze、三機自動中繼、正式成功率與耗電統計仍待完成。
