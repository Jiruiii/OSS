# Simulator（D 組：擴散模擬 + 量測）

對應 `system.md` 階段 4。一支零依賴的 Node 模擬器，把 `data/fixtures/neihu/scale-v136.json`
（~500 筆內湖事件）在執行時建成真實簽章 bundle，模擬 N 台手機在 Emergency Mode 下用
peer sync 交換分片，量測四個指標。

## 是什麼 / 不是什麼

- **是**：可重播的軟體模擬。跟手機 App 共用同一套決策與驗證邏輯（`pipeline/lib/peer-sync.mjs`、
  `contract.mjs`、`geo.mjs`），只有「傳輸層」換成種子化的接觸模型。
- **不是**：實機量測。接觸機率、傳輸速率、失敗率都是 `fixtures/sim-config.json` 裡的工程
  估計值，待組員 C 的兩台實機 spike 校準。**不宣稱在任何固定時間覆蓋全城。**
- **Energy Cost 未建模**（需指定機型實機量測，`system.md` §7）。

## 指標

| 指標 | 意義 |
|---|---|
| Data Coverage | 在 T+1/3/5/10 分，持有事件最新版的節點比例（曲線） |
| Freshness Lag | 事件發布到節點套用最新版的時間，p50 / p95 |
| Cellular Savings | 相對「每台各自下載」節省的伺服器流量 |
| Transfer Efficiency | 有效 payload / 總 P2P 傳輸量（+ 重複 / 失敗比率） |

## 怎麼跑

```
node simulator/cli.mjs run --nodes 20 --strategy rarest-first --seed 42 --geo-filter --out .sim-out
node simulator/cli.mjs matrix --out experiments/results     # 10/20/50/100 × 3 策略 × geo 全矩陣
node simulator/cli.mjs matrix --check                       # 位元比對已提交的結果
npm run test:sim
```

策略：`no-coop`（無協作，各自下載）、`replication`（一般 P2P）、`rarest-first`（先傳最稀有分片）。
`--geo-filter` 讓節點只收與自身／鄰接 area 相交的分片（CRITICAL 一律收）。

## 決定性

同 `--seed` + 同 `sim-config.json` ⇒ 位元相同的輸出。所有隨機以
`(label, round, 節點索引, chunk 序號)` 為鍵，不依呼叫順序；不使用 wall clock。
