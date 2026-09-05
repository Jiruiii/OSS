# 實驗模擬器與量測腳本（D 組，system.md 階段 4）

## Context（為什麼要做）

`system.md` §6 階段 4 與 `team-assignments.md` D 要求一套「可重播的多節點模擬」，比較不同
擴散策略並產出 §7 的指標報告。目前 repo 完全沒有這塊 —— 沒有 `simulator/` 也沒有
`experiments/` 目錄（兩者都寫在 `system.md` §9）。`simulate` 分支剛完成內湖資料集與地理
分片（chunk 帶 `area_id`/`theme`/`bbox`、`data/fixtures/neihu/scale-v136.json` ~500 筆事件、
`pipeline/lib/geo.mjs`）；`origin/main` 有組員 C 的 `pipeline/lib/peer-sync.mjs`
（`computeDiff`/`buildRequest`）。**本機 `main`（`b671cc6`，尚未 push，ahead 9）已經把兩邊
merge 好** —— 這就是本次的基底。

目標：一支零依賴的 Node 模擬器，在執行時從內湖 scale fixture 建出真實簽章 bundle，跑
10/20/50/100 節點情境，比較三種策略（無協作 / 一般 replication / rarest-first），外加一個
正交的「地理相關性過濾」開關，產出可重現的 markdown 報告，涵蓋 **4 個指標** —— Data
Coverage、Freshness Lag、Cellular Savings、Transfer Efficiency。**Energy Cost 先不做**
（需要指定機型實機量測；v1 文件註明為範圍外）。

驗收（對應 §6 階段 4 通過條件）：`node simulator/cli.mjs matrix --check` 通過 ⇒ 報告可
重現；報告每個區塊都帶情境參數與樣本數；有一個測試斷言報告沒有「固定時間覆蓋全城」這類宣稱。

## 分支

```
git switch -c experiment-harness main      # 本機 main b671cc6 已含 geo.mjs + peer-sync.mjs + scale-v136 + .gitattributes
npm test                                   # 動工前先確認 20 個 Node 測試 + 4 個 Python 測試綠燈
```

不需要額外 merge。（另一件不阻塞的事：`main` 與本分支都尚未 push，團隊仍需把
`simulate`→`origin/main` 正式合進去。收尾時提醒使用者，實作過程中不處理。）

## 目錄結構（全部新增；根目錄唯一改動是 `package.json`）

### `simulator/`
| 路徑 | 用途 |
|---|---|
| `cli.mjs` | 進入點：`run`（單次模擬）+ `matrix`（完整矩陣 + `--check`）；kebab→snake 參數解析，比照 `pipeline/cli.mjs` 風格 |
| `README.md` | 這是什麼／不是什麼、怎麼跑、決定性、「不宣稱覆蓋全城」註記 |
| `fixtures/sim-config.json` | 唯一的固定情境：`rounds`、`seconds_per_round`、節點數清單、`area_density_weights`、`adjacency`、`contact_probability`、`max_peer_count`、`cellular_chunks_per_round`、`max_bytes_per_round`、`transfer_failure_prob`、`gateway_ratio`、`cellular_fallback_rounds`、`p2p_throughput_bytes_per_sec` |
| `lib/rng.mjs` | `mulberry32`（複製自 `tools/generate-neihu-fixtures.mjs`）+ `stream(label, ...ints)` 子種子 + 決定性 Fisher–Yates shuffle/sample |
| `lib/scenario.mjs` | 讀 `data/fixtures/neihu/scale-v136.json` + `scenario.json`；`normalizeSource`→`signEvent`，用執行時 `generateEd25519KeyPair()`；`buildBundle(..., targetSizeBytes: 8192)`；由 manifest 各 chunk 的 `bbox` 依 `area_id` 聯集算出 `areaBbox[area_id]`；`latestVersionByEventId`；凍結後回傳 `ScenarioContext` |
| `lib/world.mjs` | 節點模型；依密度權重把 N 個節點決定性分配到 5 個 area；每節點 `attentionWindow`（自身 + 鄰接 area 的 bbox）；gateway 選取 |
| `lib/topology.mjs` | 決定性的 round-based 無向接觸圖：同 area ∪ 鄰接 area 為候選 → 種子 shuffle → 取前 `min(max_peer_count, 5)` → 每條邊以 `contact_probability` 實現；邊依 `(a.id,b.id)` 排序後迭代 |
| `lib/strategies.mjs` | 三策略統一介面 `{ usesPeerPhase, serverPullers, orderRequest }`；replication 直接包 `computeDiff`/`buildRequest`；rarest-first 依全域持有數升冪排序（CRITICAL 仍優先） |
| `lib/geo-filter.mjs` | `bboxIntersects(chunk.bbox, node.attentionWindow)`；`priority === 'CRITICAL'` 直接放行 |
| `lib/transfer.mjs` | 單一 chunk `src→dst`：種子失敗判定；成功則 `verifyChunk` + 逐事件 `ingestEvent`；位元組計數（useful / duplicate / failed） |
| `lib/engine.mjs` | 主迴圈：每回合 → 接觸圖 → server 階段 → peer 階段 → `sampleTimeline` |
| `lib/metrics.mjs` | 從記錄狀態（stores、位元組計數、套用回合）算出 4 個指標 |
| `lib/matrix.mjs` | 跑 10/20/50/100 × 3 策略 × geo{off,on} = 24 次；彙整後交給 report |
| `lib/report.mjs` | markdown 報告：4 個指標表 + ASCII coverage sparkline，每個區塊蓋上參數與樣本數 + Limitations 段落 |
| `test/topology.test.mjs` | 每回合每節點 peer 數 ≤ `max_peer_count` 且 ≤ 5；只有同／鄰接 area 才有邊；對稱；同種子可重現 |
| `test/strategies.test.mjs` | `cellularBytes`：rarest-first ≤ replication ≤ no-coop；協作策略下 geo-filter on < off；attentionWindow 不含某淹水 area 的節點仍會收到該 area 的 CRITICAL 淹水 chunk |
| `test/metrics.test.mjs` | coverage 對 t 單調不減、∈ [0,1]；`cellularSavings ∈ [0,1]`、no-coop 時 `== 0`；`efficiency + dupRatio + failRatio == 1`（±1e-9）；freshness `p50 ≤ p95`；被竄改的 chunk 絕不計入 coverage |
| `test/determinism.test.mjs` | 同參數兩次 `run` → canonical 序列化後位元相同；不同種子 → 不同；`matrix --check` exit 0 |
| `test/report.test.mjs` | 每個指標區塊含 `seed` / `nodes` / `sample` + 一個 `## Limitations` 標題；被禁的宣稱字串只出現在免責聲明那行；表格列數 == 矩陣格數 |

### `experiments/`
| 路徑 | 用途 |
|---|---|
| `README.md` | 結果怎麼產生／重跑、每個檔案是什麼、常設的限制聲明、Energy Cost 延後說明 |
| `scenario.md` | 散文：模擬的內湖梅雨鋒面情境、假設、真實地物 vs 虛構災情、密度與接觸模型、「round 0 一次性發布」說明 |
| `demo.md` | 逐步 demo 腳本（指令 + 要展示什麼） |
| `limitations.md` | 限制聲明，含明確的「不宣稱固定時間覆蓋全城」那行；密度假設；樣本數；Energy Cost 未建模 |
| `results/<nodes>-<strategy>[-geo].json` | 生成並 **提交進 repo**：`{ params, seed, git_rev, sample_sizes, metrics }` |
| `results/matrix-summary.json` | 生成並提交：整個矩陣彙整成一個物件 |
| `results/report.md` | 生成並提交：markdown 報告 |
| `analysis/aggregate.mjs` | 從 `results/*.json` 重算彙總表並輸出 `coverage.csv` / `summary.csv`（不重跑模擬） |
| `analysis/charts.md` | ASCII coverage 曲線 + CSV 欄位說明（零依賴、無繪圖套件） |

`.gitignore` += `.sim-out*/`（臨時 `run` 輸出）。`experiments/results/` 刻意提交進 repo。

## 模擬模型

**ScenarioContext**（`scenario.mjs`，只建一次、凍結）：執行時金鑰對 → 簽署全部 ~500 筆事件
→ `buildBundle`（~88 chunk）→ `{ manifest, chunksById, eventsById, publicKey, areaBbox,
adjacency, latestVersionByEventId, clock }`。fixture 裡的 placeholder hash／signature 一律
不用（過不了 verify）。

**Node**（`world.mjs`）：`{ id: 'sim-node-001'（符合 peer-summary node_id pattern）, areaId,
attentionWindow (bbox), isGateway, store (Map，直接餵 ingestEvent), heldChunks (Map
chunk_id→summary 條目), appliedRound (Map event_id→round), appliedVersion (Map),
計數器: cellularBytes, p2pRxBytes, usefulRxBytes, duplicateRxBytes, failedRxBytes,
chunksVerified, cellularFetches }`。
分配：`count_i = floor(N*weight_i)`，餘數依小數部分降冪分配，同分依 `area_id` 字串序。
gateway：`ceil(N*gateway_ratio)` 個，依節點索引輪流分到各 area（N ≥ 5 時每 area ≥ 1 個）。
no-coop 時每個節點都算 gateway。

**Topology**（`topology.mjs`）：主種子 `--seed K`；子流 `mulberry32(K ^ fnv1a(label) ^ mix(ints))`。
`sim-config.json` 內靜態鄰接鏈：`xihu ↔ tech-park ↔ wende ↔ dahu ↔ donghu`（依
`scenario.json` 的 seed 座標）。回合 `r`：候選 = 同 area ∪ 鄰接 area 的節點 → 用
`stream('contacts', r, nodeIdx)` shuffle → 取前 `min(max_peer_count, 5)`（schema 上限 5，
斷言）→ 每條邊以 `contact_probability` 用 `stream('edge', r, a, b)` 實現 → 無向聯集，依
排序後 id 迭代。`rounds`（預設 24）× `seconds_per_round`（預設 30）= 12 分鐘。
`T+t 分 → round(t*60/seconds_per_round)`。

**主迴圈**（`engine.mjs`）每回合：
1. `contacts = topology.round(r)`
2. **server 階段**：對每個 `serverPuller`（no-coop：全部；否則 gateway + 任何過了
   `cellular_fallback_rounds` 仍缺 CRITICAL chunk 的節點）取最多 `cellular_chunks_per_round`
   個仍缺的 chunk（若 `--geo-filter` 先過濾，CRITICAL 一律保留），`cellularBytes += size`，
   `applyChunk`（`verifyChunk` + `ingestEvent`）。
3. **peer 階段**（no-coop 跳過）：算一次 `rarity = holderCountByChunk(world)`；對每條無向邊，
   雙向 `(src→dst)`：`diff = computeDiff(summary(dst), summary(src), {datasetId, namespace})`；
   `wanted = geoFilter(diff.missing_chunks ++ diff.stale_chunks, dst)`；
   `ordered = strategy.orderRequest(dst, src, wanted, { rarity })`；在 `max_bytes_per_round`
   預算內用 `transfer.mjs` 傳 chunk。
4. `sampleTimeline(world, r)` —— 記錄每節點 coverage 快照。

**transfer.mjs** 單一 chunk：用 `stream('xfer', r, srcIdx, dstIdx, chunkSeq)` 判失敗 → 失敗則
`failedRxBytes += size`、`p2pRxBytes += size`，該有序配對這回合停止。成功則
`p2pRxBytes += size`，`verifyChunk(authoritativeChunk, manifest, publicKey, {now: simClock, trustedKeyIds})`：
若 `dst` 已持有每個事件版本 ≥ 進來的版本 → `duplicateRxBytes += size`；否則
`usefulRxBytes += size`、`chunksVerified += 1`、逐事件 `ingestEvent`，對每個
`inserted`/`updated`+`current` 結果設 `appliedRound[e]=r` / `appliedVersion[e]`。

**決定性**：不用 `Date.now()`（sim 時鐘 = `r * seconds_per_round`，以固定 ISO 字串餵入）；
每次隨機都以 `(label, round, 節點索引, chunk 序號)` 為鍵；到處用排序後 key 迭代。
`matrix --check` 在記憶體內重跑矩陣，用 `pipeline/lib/canonical.mjs` canonical 序列化，
與提交的 `results/*.json` 位元比對（忽略 `git_rev`）。

**策略**（`strategies.mjs`）：
- **無協作 / no-coop**：無 peer 階段；每個節點從 server 下載每個需要的 chunk。這是
  coverage/freshness 的參考基準，也是 Cellular Savings 的 baseline。
- **一般 replication**：只有 gateway 從 server 下載；其他節點純 P2P；`computeDiff` +
  `buildRequest` 給出請求集與 `CRITICAL>HIGH>NORMAL>LOW` 再依大小升冪的順序（就是組員 C 的
  `peer-sync.mjs`）。非 gateway 節點若過了 `cellular_fallback_rounds` 仍缺某 CRITICAL
  chunk，給一次 cellular fallback 下載。
- **rarest-first**：一樣的 gateway/fallback；`orderRequest` 把 wanted 集依全域
  `rarity[chunk_id]` 升冪排序（CRITICAL 仍插到最前）。因為 `max_bytes_per_round` 有限，
  順序會改變「哪些 chunk 先擴散」；rarest-first 讓不同 chunk 擴散更快 ⇒ 更少節點需要
  fallback。`rarity_scope: 'global' | 'neighbourhood'` config 開關；global 是有記錄的簡化。

**Geo-filter**（`geo-filter.mjs`，正交的 `--geo-filter`）：server 與 peer 階段都丟掉
`!bboxIntersects(chunk.bbox, node.attentionWindow)` 的 chunk，除非 `priority === 'CRITICAL'`
（依 `docs/peer-sync-v0.md`）。這就是內湖計畫指定的 Cellular Savings 槓桿 —— 它同時縮小
baseline 與實際 cellular bytes。

## 指標（`metrics.mjs`）—— 精確公式

`N` = 節點數。`E` = 在評估時鐘下未過期的權威事件 id（`eventState` 語意）。
`LATEST[e] = scenario.latestVersionByEventId[e]`。節點 `n` 在回合 `ρ` **持有 `e` 最新版**
定義為 `n.appliedVersion[e] === LATEST[e]` 且 `n.appliedRound[e] <= ρ`。
`R(t) = round(t*60 / seconds_per_round)`，`t ∈ {1,3,5,10}`。預設矩陣 = **round 0 一次性
發布**（讓 coverage 乾淨地單調）；`--waves` 模式存在但不納入可重現矩陣。
`seconds_per_round` / `rounds` 只存在 `sim-config.json`；`metrics.mjs` 不寫死 `60/2/6/10/20`。

1. **Data Coverage** —— `coverage(t) = (1/N) Σ_n |{e ∈ E : n 在 R(t) 前持有 e 最新版}| / |E|`。
   報告 `[coverage(1), coverage(3), coverage(5), coverage(10)]` + `coverage(final)`。
   次要欄 `strictCoverage(t) = |{n : n 在 R(t) 前每個 e ∈ E 都持有最新版}| / N`。
   測試：對 t 單調不減、每項 ∈ [0,1]。
2. **Freshness Lag** —— 對每個到模擬結束時 `n` 已持有 `e` 於 `LATEST[e]` 的 `(n,e)`：
   `lag = n.appliedRound[e]*seconds_per_round - issueRound(e)*seconds_per_round`
   （issueRound = 0）。nearest-rank 算 `p50`、`p95`，以**秒與分鐘**呈現；報告
   `applied_pairs`（每個數字都帶的樣本數）與 `unreached_pairs = N*|E| - applied_pairs`
   **以計數呈現**，絕不寫成無限延遲。測試：`p50 ≤ p95`；協作策略下 `applied_pairs > 0`。
3. **Cellular Savings** —— `baselineCellularBytes = Σ_n Σ_{c ∈ needed(n)} c.size_bytes`，
   其中 `needed(n)` = 全部 manifest chunk（geo-filter off）或與 `n.attentionWindow` 相交的
   chunk ∪ 全部 CRITICAL（geo-filter on）—— 由 manifest 解析式算出，**與當前 geo-filter
   設定一致**。`actualCellularBytes = Σ_n n.cellularBytes`。
   `cellularSavings = clamp(1 - actual/baseline, 0, 1)`。報告 baseline / actual / savings %
   / bytes saved / server fetch 次數。測試：`∈ [0,1]`；no-coop 時 `== 0`；順序
   `rarest-first ≥ replication ≥ no-coop`；協作策略下 geo-filter on 的 actual `<` off。
4. **Transfer Efficiency** —— `totalP2P = Σ_n (useful + duplicate + failed) RxBytes`。
   `transferEfficiency = Σ useful / totalP2P`（`totalP2P == 0` 時 N/A）；`duplicateRatio`、
   `failureRatio` 同理。「有效」= chunk 通過 verify **且** `ingestEvent` 對其中 ≥ 1 個事件
   回 `inserted`/`updated`。另記一個更嚴格的次要值 `usefulEventBytes`（實際新套用事件的
   `byte_length` 總和）避免頭條數字灌水。報告三個比率 + 原始位元組 + 傳輸次數 + 失敗次數。
   測試：`efficiency + dup + fail == 1`（±1e-9）、每項 ∈ [0,1]。

*(Energy Cost —— 延後。`experiments/limitations.md` 與 `simulator/README.md` 註明它需要
依 `system.md` §7 做指定機型的實機量測，v1 不建模。)*

## CLI（`simulator/cli.mjs`）

```
node simulator/cli.mjs run --nodes N --strategy S --seed K [--geo-filter] \
     [--out DIR] [--rounds R] [--seconds-per-round SEC] [--rarity-scope global|neighbourhood] [--waves] [--allow-any]

node simulator/cli.mjs matrix [--seed K] [--out experiments/results] [--geo-filter both|on|off] [--check]
```
- `run` 驗證 `nodes ∈ {10,20,50,100}`（加 `--allow-any` 可任意正整數）、
  `strategy ∈ {no-coop, replication, rarest-first}`、`seed` 為整數。寫出
  `<out>/<nodes>-<strategy>[-geo].json` 並印一行摘要（比照 `pipeline/cli.mjs`）。
  `git_rev` 由 `execFileSync('git', ['rev-parse','--short','HEAD'])` 包 try/catch 取得；
  `--check` 忽略此欄。
- `matrix` 預設矩陣 = `{10,20,50,100} × {no-coop,replication,rarest-first} × {geo off, geo on}` = 24 次 → 每次一個 JSON + `matrix-summary.json` + `report.md`。
- `matrix --check`：記憶體內重跑矩陣，canonical 序列化，與提交的
  `experiments/results/*.json` 位元比對（忽略 `git_rev`）。有差異 exit 1 + `MISMATCH: …`，
  否則 `PASS: committed experiment results match a fresh deterministic run`。比照
  `tools/generate-neihu-fixtures.mjs --check`。

## 報告（`report.mjs` → `experiments/results/report.md`）

Markdown、零依賴、**不含 wall-clock 時間戳**（保持決定性）。表頭蓋章：`scenario_id`、
`seed`、有效 `sim-config.json` 的 `sha256Canonical`、節點數清單、`rounds`、
`seconds_per_round`、fixture 路徑 + 生成器 seed、執行時 bundle 的 `manifest_id` + chunk 數
+ `total_size_bytes`。每個指標一節 = 表格 + 蓋章 caption：
1. **Data Coverage** —— 列 = 策略（× geo），欄 = T+1/T+3/T+5/T+10/final + ASCII sparkline。caption：`N nodes; seed K; <rounds> rounds @ <sec>s/round; round 0 一次性發布; 每格樣本 = N×|E| = <X> 個 event-holding。`
2. **Freshness Lag** —— 列 = 策略，欄 = p50（秒/分）、p95（秒/分）、applied pairs、unreached pairs。caption。
3. **Cellular Savings** —— 列 = 策略 × geo，欄 = baseline bytes、actual bytes、savings %、bytes saved、server fetches。caption：baseline 定義 + 「固定情境、可重現」。
4. **Transfer Efficiency** —— 列 = 策略，欄 = efficiency %、duplicate %、failure %、transfers、failed transfers、useful bytes。caption。
5. **Limitations** —— `experiments/limitations.md` 全文 + 明確一行：*「本報告不宣稱在任何
   固定時間覆蓋全城。所有數字僅適用於模擬的內湖五區情境、指定節點數與接觸模型，並附上述
   樣本數。Energy Cost 未建模。」*

圖表：報告內嵌 ASCII sparkline；`experiments/analysis/aggregate.mjs` 輸出
`coverage.csv` / `summary.csv`；`experiments/analysis/charts.md` 說明欄位並重現 ASCII
曲線。不加繪圖套件。

## package.json（根目錄唯一程式碼改動）

```json
"scripts": {
  "test": "node --test pipeline/test/*.test.mjs simulator/test/*.test.mjs",
  "test:sim": "node --test simulator/test/*.test.mjs",
  "sim:matrix": "node simulator/cli.mjs matrix --out experiments/results",
  "sim:check": "node simulator/cli.mjs matrix --check"
}
```

## Commit 切法

1. **feat(simulator): scenario context + deterministic world & topology** —— `lib/{rng,scenario,world,topology}.mjs`、`fixtures/sim-config.json`、`test/topology.test.mjs`、`README.md` 骨架。
2. **feat(simulator): engine, transfer, 3 strategies, geo-filter** —— `lib/{transfer,strategies,geo-filter,engine}.mjs`、`test/strategies.test.mjs`。
3. **feat(simulator): coverage / freshness / savings / efficiency metrics** —— `lib/metrics.mjs`、`test/metrics.test.mjs`。
4. **feat(simulator): CLI（run + matrix + --check）+ report 生成器** —— `cli.mjs`、`lib/{matrix,report}.mjs`、`test/{determinism,report}.test.mjs`、放寬 `package.json` glob、`.gitignore += .sim-out*/`。
5. **experiments: baseline 結果、CSV 分析、文件** —— 跑 `npm run sim:matrix`；提交 `experiments/results/*`、`experiments/{README,scenario,demo,limitations}.md`、`experiments/analysis/{aggregate.mjs,charts.md}`。
6. **docs: system.md 階段 4 進度 + team-assignments D** —— 標記「可重播模擬情境」+「量測腳本（4 指標）」+「三策略比較」完成；Energy Cost 保持未完成（僅模型、需實機）；註明 `simulator/` 與 `experiments/` 已依 §9 建立。

每個 commit：`npm test` 綠燈、零依賴、LF、訊息結尾 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。

## 驗證（端到端）

```
git switch -c experiment-harness main
npm test                                          # 既有 20 Node + 4 Python 綠燈

# 實作完成後：
npm test                                          # 既有 + 新 simulator 測試
node --test simulator/test/*.test.mjs

node simulator/cli.mjs run --nodes 20 --strategy rarest-first --seed 42 --geo-filter --out .sim-out
node simulator/cli.mjs run --nodes 20 --strategy rarest-first --seed 42 --geo-filter --out .sim-out2
diff .sim-out/20-rarest-first-geo.json .sim-out2/20-rarest-first-geo.json     # 應為空（決定性）

node simulator/cli.mjs matrix --out experiments/results                        # 寫出 24 次 + summary + report
node simulator/cli.mjs matrix --check                                          # PASS

python -m unittest discover -s tests -v                                        # 4 pass（未動）
python tools/replay_fixture.py --check                                         # PASS
cat experiments/results/report.md
```

驗收：`matrix --check` PASS ⇒ 可重現；`report.md` 每個區塊都有參數 + 樣本數 + Limitations
段落；`report.test.mjs` 斷言沒有固定時間覆蓋全城的宣稱；coverage T+1/3/5/10、freshness
p50/p95、cellular savings %、transfer efficiency %（+ dup/fail 比率）在完整
10/20/50/100 × 3 策略 × geo 矩陣都有。

## 風險與注意事項

- 所有 fixture 事件共用 `issued_at`（生成器 `wrap()` 蓋 `clock.issued_at`）⇒ 預設矩陣的
  freshness 是純傳播時間；在 `scenario.md` 說明。`--waves` 不納入可重現矩陣。
- `computeDiff` 遇 `manifest_id` 不符會 throw ⇒ 預設矩陣用單一 dataset 版本 / 單一 manifest ⇒ 安全。
- 全域 rarity = 真實節點沒有的全域知識；提供 `rarity_scope: 'neighbourhood'` 開關 + 報告註記。
- `buildBundle` 對 ~500 事件每次模擬跑一次（純函式、同步、毫秒級），快取並凍結。
- peer-summary 的 `max_peer_count` schema 上限為 5 —— `topology.mjs` 斷言並 clamp。
- `node_id` 必須符合 `^[a-z0-9][a-z0-9._:-]{0,127}$`（`computeDiff` 讀 `summary.node_id`）。
- 整合（push `main`、`simulate`→`origin/main` 與本分支的 PR 順序）是另一個決定 —— 收尾時
  提醒使用者，實作中不處理。
