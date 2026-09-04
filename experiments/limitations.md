# 限制聲明

`results/report.md` 的 Limitations 段落即引自此處。

## 不宣稱的事

- **不宣稱在任何固定時間覆蓋全城。** 所有數字只適用於 `scenario.md` 描述的模擬內湖五區
  情境、指定節點數（10 / 20 / 50 / 100）與接觸模型。
- 不宣稱這是真實災況或真實資料分布。災情事件為合成（真實 OSM 地物 + 虛構事件）。

## 尚未校準

接觸機率、P2P 傳輸速率、傳輸失敗率是工程估計值，寫在
`simulator/fixtures/sim-config.json`，`transport_params_source` 標為
`engineering-estimate-pending-device-spike`。組員 C 的兩台實機 spike（`system.md` 階段 0）
量到 1 MB / 10 MB 的連線時間、傳輸速度、斷線恢復後，應更新該檔並重跑
`node simulator/cli.mjs matrix --out experiments/results`。

## 未建模

- **Energy Cost。** `system.md` §7 要求指定機型、電量、掃描頻率下的實機量測，純軟體模擬
  做不到真值，v1 不建模。之後要接：以裝置電力 log（`elapsed_s,power_mw` CSV）計算
  每小時額外耗電，並在報告另開一欄標明「模型 + N 台實機」。
- **移動模型。** 節點位置固定在所屬 area，只有接觸圖隨回合變化；沒有連續移動 / 速度。
- **傳輸層細節。** 沒有分段 framing、checksum、超時、背景限制；`verifyChunk` 之前的
  bytes 一律當作完整收到或完全失敗。

## 樣本數

報告每個平均值都在該區塊 caption 標了樣本數：coverage 每格 = N × |E|（500）個
event-holding；freshness 每列 = applied pairs 欄；transfer efficiency 每列 = transfers 欄。
單一 seed（預設 20260904），非多次抽樣的信賴區間。
