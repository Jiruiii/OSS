/**
 * Render the matrix result list into the committed markdown report.
 * Zero-dependency, no wall-clock timestamp (determinism).
 */

import { canonicalize, sha256Canonical } from '../../pipeline/lib/canonical.mjs';

export const LIMITATIONS = `本報告不宣稱在任何固定時間覆蓋全城。所有數字僅適用於下方參數描述的
模擬內湖五區情境、指定節點數與接觸模型，並附各區塊標註的樣本數。接觸機率、P2P 傳輸速率與
失敗率是工程估計值，尚未由實機 spike 校準（見 \`simulator/fixtures/sim-config.json\` 的
\`transport_params_source\`）。**Energy Cost 已用 Pixel 7 實機量測（見上方第 5 節，交錯 6 輪 × 60 筆），但只有單一機型、鄰居數固定為 1，且只涵蓋「持續發現」情境——目前的 Emergency Mode 服務不會自行建立 GATT 連線傳輸分片，實際同步時的耗電尚未量測**；這一節不是模擬器輸出的一部分。
災情事件為虛構（真實 OSM 地物 + 合成事件），不代表任何真實災況。`;

// Real-device measurement, not simulator output — hardcoded rather than
// computed from `results`/`scenario`/`config` like the other sections,
// since it doesn't come from a matrix run. Source CSVs:
// experiments/results/energy-raw/pixel7-{baseline,emergency-mode}-2026-09-05.csv.
// The pixel7-{scan-only,scan-plus-transfer} files in that directory are the
// withdrawn 2026-09-05 measurement — see that directory's README before
// citing anything from them.
export const ENERGY_COST = `Emergency Mode 的實機耗電。不是模擬器輸出——這一項 system.md §7 本來就要求指定機型實機量測，模擬器不建模功耗。

**方法**：Pixel 7（電量 85%、狀態 \`Not charging\`，電池電流是真的放電），螢幕關閉，另一台 Pixel 8a 全程開著 Emergency Mode 當鄰居節點。兩個條件交錯跑 6 輪、每輪 60 筆取樣：

1. \`baseline\`：App 已 force-stop，Emergency Mode 未啟動。
2. \`emergency-mode\`：Emergency Mode 開啟（BLE 廣播 + 過濾掃描的前景服務）。

功率由電池計量器換算：\`|current_now| × voltage_now × 1e-9\`（µA × µV ⇒ mW）。每一輪開始前與結束後都用 logcat 確認服務狀態（\`discovery=true\`、\`peers=1\`），確認不到就標記 FAILED 並丟棄該輪，不產出數字。原始資料：\`experiments/results/energy-raw/pixel7-{baseline,emergency-mode}-2026-09-05.csv\`（各 360 筆 = 6 輪 × 60）。

| 條件 | 各輪中位數（6 輪，mW） | 彙總中位數 | 各輪中位數的中位數 |
| --- | --- | ---: | ---: |
| baseline | 363, 367, 375, 395, 398, **748** | 395.8 mW | **385.1 mW** |
| emergency-mode | 426, 433, 438, 440, 447, 474 | 438.7 mW | **439.1 mW** |

**結論**：Emergency Mode 相對 baseline 增加約 **+54 mW**（各輪中位數的中位數；彙總中位數算法為 +43 mW），約為 baseline 的 **+14%**。以 Pixel 7 的 4,355 mAh／3.85 V（約 16.8 Wh）電池換算，持續開啟一小時約多消耗 **0.3% 電量**。

報告中位數而非平均值：電池計量器有明顯右尾（不相干的系統喚醒會產生數倍於典型值的單點），60 筆視窗的平均值很容易被單一暫態拉走。baseline 第 3 輪的 748 mW 是一次被系統背景工作污染的異常（其餘五輪聚集在 363–398），**保留在資料中而非刪除**，並改用對單輪異常穩健的「各輪中位數的中位數」作為主要估計值；兩種算法的差距（+43 vs +54 mW）即由這一輪造成，一併揭露。

**只涵蓋「發現」，不含傳輸**：目前的 Emergency Mode 服務只做 BLE 廣播與掃描，不會自行建立 GATT 連線傳輸分片，所以這組數字是**待命中持續發現鄰居的邊際成本**，不是同步進行中的耗電。實際交換分片時的功率尚未量測。

**先前 2026-09-05 的量測已作廢**：\`pixel7-scan-only\` / \`pixel7-scan-plus-transfer\` 兩份 CSV 是在插著 USB、電量全滿的手機上取樣，電池電流在零附近震盪，記錄到的是計量器雜訊而非耗電。三項證據：兩個「不同條件」的 min／p25／median 完全相同（1.35／10.83／20.31）；22 mW 對整支手機而言物理上不可能（本次量到螢幕關閉的閒置就是約 385 mW）；滿電插電的 Pixel 8a 今天可重現同樣的型態。當時報告的「22.35 → 26.78 mW、+4.4 mW、1810 mW 連線尖峰」全部不應再引用。詳見 \`experiments/results/energy-raw/README.md\`。

**限制**：
- 只有 1 台機型（Pixel 7）。跨機型耗電未量測。
- 螢幕關閉但未驗證進入 Doze；長時間背景存活下的耗電可能不同。
- 鄰居數固定為 1。掃描到的節點數變多時的耗電未量測。
- 不含 GATT 連線與分片傳輸的耗電（見上）。`;

const TICKS = '▁▂▃▄▅▆▇█';

function sparkline(values) {
  return values.map((v) => TICKS[Math.min(7, Math.max(0, Math.round(v * 7)))]).join('');
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function kib(bytes) {
  return `${Math.round(bytes / 1024).toLocaleString('en-US')} KiB`;
}

function rowLabel(key) {
  const parts = key.split('-');
  const geo = parts.at(-1) === 'geo';
  const nodeCount = parts[0];
  const strategy = parts.slice(1, geo ? -1 : undefined).join('-');
  return `${String(nodeCount).padStart(3)} · ${strategy}${geo ? ' · geo' : ''}`;
}

export function renderReport(results, scenario, config) {
  const seed = results[0]?.params.seed;
  const rounds = results[0]?.params.rounds;
  const secondsPerRound = results[0]?.params.seconds_per_round;
  const windowMinutes = ((rounds * secondsPerRound) / 60).toFixed(0);
  const configHash = sha256Canonical(config);
  const eventCount = scenario.eventIdentities.length;

  const lines = [];
  const push = (...text) => lines.push(...text);

  push('# ResilientGeo Mesh — 內湖擴散模擬報告', '');
  push('<!-- 由 `node simulator/cli.mjs matrix` 生成，請勿手改。`matrix --check` 會位元比對。 -->', '');

  push('## 情境參數', '');
  push('| 項目 | 值 |', '| --- | --- |');
  push(`| scenario_id | \`${config.scenario_id}\` |`);
  push(`| seed | ${seed} |`);
  push(`| sim-config.json sha256 | \`${configHash}\` |`);
  push(`| 節點數 | ${config.node_counts.join(', ')} |`);
  push(`| 回合 × 每回合秒數 | ${rounds} × ${secondsPerRound}s（模擬 ${windowMinutes} 分鐘） |`);
  push(`| 發布模型 | round 0 一次性發布 |`);
  push(`| rarity_scope | \`${results[0]?.params.rarity_scope}\` |`);
  push(`| 來源 fixture | \`data/fixtures/neihu/${scenario.fixture}\`（生成器 seed ${scenario.generatorSeed}） |`);
  push(`| 執行時 bundle | \`${scenario.manifest.manifest_id}\`，${scenario.chunkCount} chunk，${kib(scenario.totalSizeBytes)} |`);
  push(`| 事件識別數 \\|E\\| | ${eventCount} |`);
  push('');

  // 1. Data Coverage
  push('## 1. Data Coverage', '');
  push('每格 = 該回合前持有事件最新版的節點比例（對全部 |E| 平均）。`relevant` 欄只算節點想要的事件（geo-filter 有開時才不同）。', '');
  push('| 節點·策略 | T+1 | T+3 | T+5 | T+10 | final | relevant final | 曲線 |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | :-- |');
  for (const r of results) {
    const c = r.coverage;
    push(
      `| ${rowLabel(r.key)} | ${pct(c.curve[0])} | ${pct(c.curve[1])} | ${pct(c.curve[2])} | ${pct(c.curve[3])} | ${pct(c.final)} | ${pct(c.relevant_final)} | \`${sparkline(c.per_round)}\` |`,
    );
  }
  push('');
  push(
    `> 條件：seed ${seed}；${rounds} 回合 @ ${secondsPerRound}s；round 0 一次性發布；每格樣本 = N × |E|（10/20/50/100 → ${config.node_counts.map((n) => (n * eventCount).toLocaleString('en-US')).join(' / ')} 個 event-holding）。曲線為每回合 coverage 的 sparkline（${TICKS[0]}=0，${TICKS[7]}=100%）。`,
    '',
  );

  // 2. Freshness Lag
  push('## 2. Freshness Lag', '');
  push('事件發布到節點套用最新版的時間。未達成的 (節點, 事件) 配對以計數呈現，不當作無限延遲。', '');
  push('| 節點·策略 | p50 | p95 | applied pairs | unreached pairs |');
  push('| --- | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const f = r.freshness;
    const p50 = f.p50_seconds === null ? 'n/a' : `${f.p50_seconds}s (${f.p50_minutes}m)`;
    const p95 = f.p95_seconds === null ? 'n/a' : `${f.p95_seconds}s (${f.p95_minutes}m)`;
    push(
      `| ${rowLabel(r.key)} | ${p50} | ${p95} | ${f.applied_pairs.toLocaleString('en-US')} | ${f.unreached_pairs.toLocaleString('en-US')} |`,
    );
  }
  push('', `> 條件：seed ${seed}；p50/p95 為 nearest-rank，樣本 = applied pairs 欄。`, '');

  // 3. Cellular Savings
  push('## 3. Cellular Savings', '');
  push(
    'baseline = 節點最終持有的每個 byte 都當作向 server 下載。所以 no-coop（每片都是 server 拉的）落在 0，協作策略落在高點。`vs full` = 相對「每台各自下載整份資料集」，geo-filter 的效益在這欄顯現。',
    '',
  );
  push('| 節點·策略 | baseline | actual (cellular) | savings | vs full | bytes saved | server fetches |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const c = r.cellular;
    push(
      `| ${rowLabel(r.key)} | ${kib(c.baseline_bytes)} | ${kib(c.actual_bytes)} | ${pct(c.savings)} | ${pct(c.total_vs_full)} | ${kib(c.bytes_saved)} | ${c.server_fetches.toLocaleString('en-US')} |`,
    );
  }
  push(
    '',
    `> 條件：seed ${seed}；固定情境、固定 seed ⇒ 每次跑數字相同（\`matrix --check\`）。baseline / actual / vs full 皆為 N 個節點加總。`,
    '',
  );

  // 4. Transfer Efficiency
  push('## 4. Transfer Efficiency', '');
  push('有效 payload / 總 P2P 傳輸量。三個比率相加為 1。no-coop 無 P2P，全欄 n/a。', '');
  push('| 節點·策略 | efficiency | duplicate | failure | transfers | failed | useful bytes |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const t = r.transfer;
    push(
      `| ${rowLabel(r.key)} | ${pct(t.efficiency)} | ${pct(t.duplicate_ratio)} | ${pct(t.failure_ratio)} | ${t.transfers.toLocaleString('en-US')} | ${t.failed_transfers.toLocaleString('en-US')} | ${kib(t.useful_bytes)} |`,
    );
  }
  push(
    '',
    `> 條件：seed ${seed}；「有效」= chunk 通過 verify 且至少一個事件被新套用；樣本 = transfers 欄（成功傳輸次數）。`,
    '',
  );

  // 5. Energy Cost — real-device measurement, not derived from `results`.
  push('## 5. Energy Cost', '', ENERGY_COST, '');

  push('## Limitations', '', LIMITATIONS, '');

  return `${lines.join('\n')}\n`;
}

export function matrixSummary(results, scenario, config) {
  return {
    scenario_id: config.scenario_id,
    seed: results[0]?.params.seed,
    config_sha256: sha256Canonical(config),
    fixture: scenario.fixture,
    generator_seed: scenario.generatorSeed,
    manifest_id: scenario.manifest.manifest_id,
    chunk_count: scenario.chunkCount,
    total_size_bytes: scenario.totalSizeBytes,
    event_count: scenario.eventIdentities.length,
    runs: results.map((r) => ({
      key: r.key,
      coverage_final: r.coverage.final,
      coverage_relevant_final: r.coverage.relevant_final,
      coverage_curve: r.coverage.curve,
      freshness_p50_seconds: r.freshness.p50_seconds,
      freshness_p95_seconds: r.freshness.p95_seconds,
      cellular_savings: r.cellular.savings,
      cellular_total_vs_full: r.cellular.total_vs_full,
      transfer_efficiency: r.transfer.efficiency,
      transfer_duplicate_ratio: r.transfer.duplicate_ratio,
      transfer_failure_ratio: r.transfer.failure_ratio,
    })),
  };
}

/** Canonical bytes of a run result with volatile fields removed, for --check. */
export function canonicalRun(result) {
  const { git_rev, ...stable } = result;
  return canonicalize(stable);
}
