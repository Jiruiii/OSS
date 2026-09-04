# Demo 腳本（模擬器）

目的：不需要實機，也能展示「只交換彼此缺少的分片」與三種策略的差異。約 5 分鐘。

## 0. 前置

```
git switch experiment-harness
npm test            # 全綠（pipeline + simulator）
```

## 1. 單機基準：無協作

```
node simulator/cli.mjs run --nodes 50 --strategy no-coop --seed 20260904 --out .sim-out
```

指出摘要裡 `coverage_final ≈ 0.65`、`cellular_savings = 0`。
說明：50 台手機各自從 server 拉，12 分鐘內誰都沒抓完，也沒有任何流量節省。

## 2. 加上 peer sync

```
node simulator/cli.mjs run --nodes 50 --strategy replication --seed 20260904 --out .sim-out
node simulator/cli.mjs run --nodes 50 --strategy rarest-first --seed 20260904 --out .sim-out
```

`coverage_final ≈ 1.0`、`cellular_savings ≈ 0.80–0.82`、`transfer_efficiency ≈ 0.61–0.65`。
說明：只有 gateway 還在用行動網路，其餘節點靠 P2P 補齊；~80% 的位元組不再向 server 要。
rarest-first 比 replication 省更多、重複傳輸更少。

## 3. 地理相關性過濾

```
node simulator/cli.mjs run --nodes 50 --strategy rarest-first --seed 20260904 --geo-filter --out .sim-out
```

`coverage_relevant_final ≈ 1.0`、`cellular_total_vs_full ≈ 0.90`、`freshness_p50_seconds` 降到 ~150。
說明：住西湖的節點不去抓大湖山莊的土石流分片，但全區級淹水警報仍然收得到。相對「每台
下載整份資料集」省了 ~90%。

## 4. 全矩陣與報告

```
node simulator/cli.mjs matrix --out experiments/results
node simulator/cli.mjs matrix --check          # PASS —— 報告可重現
sed -n '1,40p' experiments/results/report.md
```

展示 `report.md`：4 個指標表、每列末的 ASCII 曲線、每個區塊的樣本數、Limitations 段落
（明確不宣稱固定時間覆蓋全城；Energy Cost 未建模）。

## 收尾要講的限制

傳輸參數是工程估計值，待組員 C 的兩台實機 spike 校準；改 `sim-config.json` 一個檔就能
重跑整份報告。詳見 `experiments/limitations.md`。
