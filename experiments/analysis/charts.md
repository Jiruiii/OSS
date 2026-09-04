# Charts（ASCII，零依賴）

repo 目前零依賴，不放繪圖套件。要正式圖表就把 `coverage.csv` / `summary.csv` 丟進
試算表或 matplotlib。以下曲線由 `results/*.json` 的 `coverage.per_round` 直接畫出，
`node experiments/analysis/aggregate.mjs` 重新產生 CSV。

## CSV 欄位

**`coverage.csv`**（每回合長格式，繪擴散曲線用）：
`key, nodes, strategy, geo, round, seconds, coverage`

**`summary.csv`**（每格一列）：
`key, nodes, strategy, geo, coverage_final, coverage_relevant_final, freshness_p50_s,
freshness_p95_s, cellular_savings, cellular_vs_full, transfer_efficiency,
transfer_duplicate, transfer_failure, server_fetches`

## Coverage over time（N=50，seed 20260904，每回合 30 秒）

`▁`=0%，`█`=100%。24 個字元 = 24 回合 = 12 分鐘。

```
no-coop            ▁▁▂▂▂▂▂▃▃▃▃▃▃▄▄▄▄▄▅▅▅▅▅▆   final 65%
replication        ▁▁▂▃▃▄▄▅▅▆▆▇▇▇▇█████████   final 100%
rarest-first       ▁▁▂▃▃▄▅▅▆▆▇▇▇▇██████████   final 100%
no-coop     · geo  ▁▁▂▂▂▂▂▃▃▃▃▃▃▄▄▄▄▄▄▄▄▅▅▅   final 53%  (relevant 89%)
replication · geo  ▁▁▂▂▃▃▄▄▄▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅   final 61%  (relevant 100%)
rarest-first· geo  ▁▁▂▂▃▃▄▄▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅   final 61%  (relevant 100%)
```

讀法：

- `no-coop` 是一條斜率固定的直線 —— 每個節點每回合只從 server 拉 2 片，24 回合抓不完 83 片。
- 協作策略在 ~round 8 之後陡升，peer 交換讓不在 server 拉取清單前段的分片也擴散開。
- `geo` 曲線較早壓平在 ~61%（全部事件），因為節點刻意不抓遠處分片；對「想要的」事件
  （`relevant`）其實已達 100%。

其他節點數（10 / 20 / 100）的曲線在 `report.md` 每列末的 sparkline 欄。
