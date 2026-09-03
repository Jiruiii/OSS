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

## 未選方案與原因

- 純 BLE：保留給 discovery 與控制訊息；吞吐量與 MTU／背景限制不適合作為主要 chunk 傳輸。
- 只依賴 Wi-Fi Direct：原生 API 的裝置相容性、配對與背景行為需要實測，不能在沒有 Spike 數據時宣稱穩定。
- 把 Nearby Connections 直接散落在 domain code：會讓日後更換 transport 的成本提高，也難以在 simulator 使用 fake transport。

## 通過與停止條件

通過條件是兩台指定測試機可重複完成 discovery、連線、1／10 MB 傳輸與斷線續傳；所有數據附測試條件。若某候選只能在單一機型工作，或鎖屏後無法完成最小同步，該候選停止進入 MVP，回到另一個 adapter 或縮小同步範圍。

## 後續

完成實機 Spike 後，把本 ADR 的 Proposed 更新為 Accepted 或 Rejected，附上原始量測檔與選擇理由。未完成前不開始依賴該 transport 的 Android UI 工作。
