# 限制聲明

`results/report.md` 的 Limitations 段落即引自此處。

## 不宣稱的事

- **不宣稱在任何固定時間覆蓋全城。** 所有數字只適用於 `scenario.md` 描述的模擬內湖五區
  情境、指定節點數（10 / 20 / 50 / 100）與接觸模型。
- 不宣稱這是真實災況或真實資料分布。災情事件為合成（真實 OSM 地物 + 虛構事件）。

## 尚未校準

`simulator/fixtures/sim-config.json` 的 `transport_params_source` 已從
`engineering-estimate-pending-device-spike` 更新為 `ble-gatt-real-device-2026-09-05`，
但只有 **`max_bytes_per_round`**（單次接觸能傳多少 bytes）真的用 Pixel 7 + Pixel 8a 的
BLE GATT 實機接觸窗量測校準（3.8–4.4 KB/s，取最保守的 10 秒短窗數字 × 30 秒回合長度）。
`contact_probability`（節點多常真的碰面）與 `transfer_failure_prob`（傳輸失敗率）仍是工程
估計值——目前的實機數據是「BLE 連線/傳輸層」的量測，沒有一項直接對應到這兩個描述真實世界
社交接觸模式的參數，硬套上去只會是假精確，維持原值並如實標注。

## 已測，但只有單一機型

- **Energy Cost。** `system.md` §7 要求的實機量測已重做（見 `results/report.md` 第 5 節）：
  Pixel 7、螢幕關閉、另一台手機當鄰居節點，baseline 與 Emergency Mode 交錯 6 輪、每輪 60 筆，
  得到約 **+54 mW（+14%）** 的邊際成本。**同日稍早那組 22.35 → 26.78 mW 已作廢**——當時手機
  插著 USB 且電量全滿，量到的是零附近的計量器雜訊而非耗電（兩組「不同條件」的 min／p25／
  median 完全相同即為證據），詳見 `results/energy-raw/README.md`。
  現有數字仍只有 1 台機型、鄰居數固定為 1、螢幕關閉但未驗證進入 Doze，且**只涵蓋「持續發現」
  這一種型態**——目前的 Emergency Mode 服務不會自行建立 GATT 連線傳輸分片，所以實際交換資料
  時的耗電還沒量過。

## 未建模

- **移動模型。** 節點位置固定在所屬 area，只有接觸圖隨回合變化；沒有連續移動 / 速度。
- **傳輸層細節。** 模擬器本身沒有分段 framing、checksum、超時、背景限制；`verifyChunk` 之前的
  bytes 一律當作完整收到或完全失敗——真實的位元組級續傳、GATT MTU 協商、訊息序號等細節
  只在 Android 端的 `BleGattTransport` 實作與實機驗證中處理，模擬器刻意不重現這層複雜度。
- **固定大小切分讓版本更新無法真正 delta。** `manifest.chunking.algorithm` 是
  `fixed-size`：資料集新版本只要有一筆事件變動，同組後面所有 chunk 的邊界就會位移、
  hash 全變，等於整組重傳。內容導向切分（CDC）或組內單事件對齊可以修，但工作量不小，
  v0 不處理。（跨 `manifest_id` 的 DIFF 行為本身已經處理好：新版本整組覆蓋舊版本的 DTN
  規則已實作並有測試，不受這條限制影響。）
- **HELLO 表示法會隨資料集線性膨脹。** 目前逐條列舉 chunk（現況 183 chunk ≈ 36 KB），
  全台規模的資料集會膨脹到數百 KB，在一次 opportunistic contact 的接觸窗內傳不完。
  Bloom filter 或對 manifest 順序的 bitmap 表示法可以把這個數字壓到 23 bytes 等級，
  已寫進 `system.md` §5 當已知擴展路徑，v0 資料量夠小不需要現在實作。

## 樣本數

報告每個平均值都在該區塊 caption 標了樣本數：coverage 每格 = N × |E|（500）個
event-holding；freshness 每列 = applied pairs 欄；transfer efficiency 每列 = transfers 欄。
單一 seed（預設 20260904），非多次抽樣的信賴區間。
