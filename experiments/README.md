# Experiments（D 組：模擬結果與報告）

`system.md` 階段 4 的產物。內容全部由 `simulator/` 決定性生成，可重跑比對。

## 檔案

| 路徑 | 說明 |
|---|---|
| `results/<nodes>-<strategy>[-geo].json` | 單一 run 的完整指標 + 參數 + `git_rev` + 樣本數 |
| `results/matrix-summary.json` | 整個 24 格矩陣的摘要（一個物件） |
| `results/report.md` | markdown 報告（4 指標表 + ASCII 曲線 + Limitations） |
| `analysis/aggregate.mjs` | 把 `results/*.json` 重整成 `coverage.csv`（每回合長格式）與 `summary.csv`（每格一列），不重跑模擬 |
| `analysis/coverage.csv` / `summary.csv` | 給試算表 / 繪圖工具用 |
| `analysis/charts.md` | ASCII coverage 曲線 + CSV 欄位說明 |
| `scenario.md` | 模擬情境的完整敘述與假設 |
| `demo.md` | 逐步 demo 腳本 |
| `limitations.md` | 限制聲明（報告的 Limitations 段落即引自此處的精神） |

## 重新產生

```
node simulator/cli.mjs matrix --out experiments/results   # 重寫 results/ + report.md
node experiments/analysis/aggregate.mjs                    # 重寫 analysis/*.csv
node simulator/cli.mjs matrix --check                      # 位元比對已提交的 results/
npm run test:sim                                           # 模擬器測試
```

固定 `--seed`（預設 20260904）＋ 固定 `simulator/fixtures/sim-config.json` ⇒ 位元相同的輸出。
改參數就改 `sim-config.json` 再重跑；`git_rev` 欄不參與 `--check` 比對。

## 主要結論（seed 20260904）

- **無協作**：頻寬受限，coverage 停在 ~65%，Cellular Savings 0。
- **一般 replication**：coverage ~100%，~80% 的位元組來自 peer 而非 server，p50 freshness 3.5–4 分。
- **rarest-first**：在每個節點數都優於 replication —— savings、transfer efficiency、freshness 皆較佳。
- **地理相關性過濾（geo）**：節點只抓自身／鄰接 area 的分片，`relevant` coverage 仍達 ~100%，相對「各自下載整份資料集」的節省升到 ~85–90%，freshness p50 進一步降到 2.5–3 分。

數字只在下述情境成立，且傳輸參數尚待實機校準 —— 見 `limitations.md`。
