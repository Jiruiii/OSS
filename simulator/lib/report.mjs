/**
 * Render the matrix result list into the committed markdown report.
 * Zero-dependency, no wall-clock timestamp (determinism).
 */

import { canonicalize, sha256Canonical } from '../../pipeline/lib/canonical.mjs';

export const LIMITATIONS = `本報告不宣稱在任何固定時間覆蓋全城。所有數字僅適用於下方參數描述的
模擬內湖五區情境、指定節點數與接觸模型，並附各區塊標註的樣本數。接觸機率、P2P 傳輸速率與
失敗率是工程估計值，尚未由實機 spike 校準（見 \`simulator/fixtures/sim-config.json\` 的
\`transport_params_source\`）。**Energy Cost 已用 Pixel 7 實機量測（見上方第 5 節），但只有單一機型、單一 60 秒視窗，且只涵蓋持續傳輸情境**，不是多輪重複量測，也不是模擬器輸出的一部分。
災情事件為虛構（真實 OSM 地物 + 合成事件），不代表任何真實災況。`;

// Real-device measurement, not simulator output — hardcoded rather than
// computed from `results`/`scenario`/`config` like the other sections,
// since it doesn't come from a matrix run. Source CSVs:
// experiments/results/energy-raw/pixel7-{scan-only,scan-plus-transfer}-2026-09-05.csv.
export const ENERGY_COST = `Emergency Mode 每小時額外耗電。不是模擬器輸出——這一項 system.md §7 本來就要求指定機型實機量測，模擬器不建模功耗。

**方法**：Pixel 7，Android 電池歷史 API 取樣，每秒一筆 \`elapsed_s,power_mw\`，各跑 60 秒：

1. \`scan-only\`：只跑 BLE advertise/scan（\`BleDiscovery\`），不建立連線、不傳輸。
2. \`scan+transfer\`：scan 的同時建立 GATT 連線並持續傳輸資料。

原始 CSV：\`experiments/results/energy-raw/pixel7-{scan-only,scan-plus-transfer}-2026-09-05.csv\`（各 59 筆取樣，n=59）。

| 情境 | 平均功率 | 最小值 | 最大值 | 樣本數 |
| --- | ---: | ---: | ---: | ---: |
| scan-only | 22.35 mW | 1.35 mW | 69.06 mW | 59 |
| scan+transfer（含連線瞬間尖峰） | 57.01 mW | 1.35 mW | 1810.38 mW | 59 |
| scan+transfer（扣除連線瞬間尖峰，見下） | **26.78 mW** | 1.35 mW | 144.88 mW | 58 |

\`scan+transfer\` 原始序列第一筆取樣是 1810.38 mW——GATT 連線建立瞬間的功率尖峰，不是傳輸期間的穩態耗電，計算平均時扣除這一筆（n=58）才能反映「持續傳輸中」的實際耗電，否則單一尖峰會把 60 秒平均拉高超過 2 倍、失真。

**結論**：持續傳輸相對 scan-only baseline 增加約 **4.4 mW**（26.78 − 22.35），約 20% 的增幅；連線建立瞬間另有一次性尖峰（約 1.8 W），與穩態耗電分開報告。

**樣本數與限制（如實揭露，不是藉口）**：
- 只有 1 台機型（Pixel 7）、1 次 60 秒視窗，不是多輪重複量測，數字有多少統計雜訊未知。
- 只涵蓋「持續傳輸」情境，沒有量測 Emergency Mode 實際運作型態（間歇性接觸、掃描退避、critical-first 排程下的間歇傳輸）的耗電，兩者功率曲線形狀可能不同。
- 未涵蓋鎖屏情境下 foreground service 的耗電（鎖屏連線成功率本身是 0%，見 \`docs/adr/ADR-001-transport-layer.md\` 的回填段落，這組耗電數字是亮屏量到的）。
- 是否代表「Emergency Mode 每小時額外耗電」需要換算：以 26.78 mW 持續一小時計算約 26.78 mWh，但這假設全程都在傳輸，不是真實使用模式下的間歇性接觸——換算成「每小時」前，這個假設本身要在 demo 或文件裡講清楚，不要直接報一個聽起來精確的每小時數字。`;

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
