# ADR-001：MVP 傳輸層選擇

- 狀態：Proposed，等待兩台 Android 實機 Spike
- 日期：2026-09-01
- 範圍：階段 0 的 Peer discovery 與 chunk transfer

## 背景

ResilientGeo Mesh 需要在低頻寬或局部斷線時交換數百 KB 到數 MB 的事件分片。傳輸 API 必須可中斷續傳，也不能讓資料套用規則綁死單一 Android API。BLE 適合低功耗發現，但不應預設它能有效承擔大量 GIS payload。

## 暫定決策

先定義與平台無關的 `PeerTransport` 介面，至少包含：

```text
discover() -> PeerAdvertisement
connect(peer_id) -> Connection
send(request, offset) -> TransferStream
resume(request, offset) -> TransferStream
close(connection)
```

階段 0 同時 Spike：

1. Nearby Connections：作為較高階的 bulk-transfer 候選。
2. 原生 Wi-Fi Direct + BLE discovery：作為平台原生候選與 fallback 參考。
3. 純 BLE：只測 discovery 與小訊息，不列為 1／10 MB bulk transfer 的 MVP 候選。

在實機數據出來前，不把候選寫死成 Android App 的 domain logic。若 Nearby Connections 在指定機型／版本上通過驗收，MVP 優先採用它承載 chunk；否則採用原生 Wi-Fi Direct adapter，並保留同一個 `PeerTransport` 介面。

## Spike 必記錄數據

| 項目 | 方法 |
| --- | --- |
| 裝置相容性 | 至少兩個品牌、兩個 Android 版本，各跑 5 次 |
| Discovery latency | 從啟動掃描到雙方收到 HELLO 的 p50／p95 |
| Connection success | 20 次連線成功率，分亮屏／鎖屏情境 |
| Throughput | 1 MB、10 MB 的有效 payload bytes／秒 |
| Resume | 在 25%、50%、75% 進度人為斷線，重新連線後是否能完成 |
| Energy | 固定掃描頻率與傳輸量下的額外耗電 |
| Background behavior | 前景服務、鎖屏、切換 App 後能否完成最小同步 |

## 實測記錄（2026-09-04，BLE discovery 部分）

裝置：Pixel 7（`2A221FDH2004RL`，API 37）與 Pixel 8a（`41051JEKB12762`，API 37），同房間近距離，皆透過 USB 接同一台電腦以 `adb` 驅動（非手動操作 UI）；螢幕亮起情境跑 5 次，另跑 1 次鎖屏情境。

**重要發現並已修正的 bug**：`BleDiscovery.startScanning()` 原本以 `scanner.startScan(null, ...)` 掃描，未過濾 `SERVICE_UUID`，導致第一輪測試量到的是環境中任意 BLE 裝置（耳機、手錶等），不是彼此的廣播——Pixel 7 那輪甚至換了兩個不同 MAC，latency 高達 85–133 秒，明顯是雜訊。已加上 `ScanFilter.setServiceUuid(SERVICE_UUID)`（`transport/BleDiscovery.kt`）修正後重測，兩台裝置各自穩定只看到對方那一個 MAC。

- **Discovery latency（亮屏，5 次，ms）**
  - Pixel 7：246, 419, 531, 536, 540 → p50 = 531ms，p95 ≈ 540ms
  - Pixel 8a：99, 104, 114, 142, 283 → p50 = 114ms，p95 ≈ 283ms
- **裝置相容性**：目前只有兩台裝置，皆為 Pixel 品牌、同一 API 37 — 尚未滿足「至少兩個品牌、兩個 Android 版本」，這點還沒過關，需要再借一支非 Pixel 或不同 API 版本的機器。
- **Background / 鎖屏行為（初步）**：Pixel 7 於掃描中以電源鍵鎖屏（確認 `dumpsys power` 顯示 `mWakefulness=Dozing`），鎖屏後 15 秒內兩台裝置仍持續收到彼此的 BLE 廣播（logcat 持續有 `saw device` 紀錄），沒有立即被系統殺掉。**只驗證了 15 秒內**，尚未驗證數分鐘後進入 Doze 模式或背景多久之後是否會被系統掛起。
- **尚未測試**：Connection success rate（尚無 `connect()` 實作）、Throughput（1MB/10MB，需要 `NearbyConnectionsTransport`）、Resume（斷線續傳）、Energy（耗電）。

結論：BLE discovery 本身在受控環境下運作正常且延遲低（多在 1 秒內），但**通過條件尚未達成**——缺 bulk transfer 實作、缺第二個品牌/版本的裝置、缺長時間背景行為驗證。狀態維持 `Proposed`，下一步是實作 `NearbyConnectionsTransport`（見任務清單）。

## 未選方案與原因

- 純 BLE：保留給 discovery 與控制訊息；吞吐量與 MTU／背景限制不適合作為主要 chunk 傳輸。
- 只依賴 Wi-Fi Direct：原生 API 的裝置相容性、配對與背景行為需要實測，不能在沒有 Spike 數據時宣稱穩定。
- 把 Nearby Connections 直接散落在 domain code：會讓日後更換 transport 的成本提高，也難以在 simulator 使用 fake transport。

## 通過與停止條件

通過條件是兩台指定測試機可重複完成 discovery、連線、1／10 MB 傳輸與斷線續傳；所有數據附測試條件。若某候選只能在單一機型工作，或鎖屏後無法完成最小同步，該候選停止進入 MVP，回到另一個 adapter 或縮小同步範圍。

## 後續

完成實機 Spike 後，把本 ADR 的 Proposed 更新為 Accepted 或 Rejected，附上原始量測檔與選擇理由。未完成前不開始依賴該 transport 的 Android UI 工作。
